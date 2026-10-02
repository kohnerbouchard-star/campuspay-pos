-- Operator-facing readiness and safe recovery. New functions retain the RPC boundary.
create function api.operator_readiness(p_session_id uuid) returns table(result jsonb)
language plpgsql security definer set search_path = '' as $$
declare s private.staff_sessions;
begin
 s:=private.assert_session(p_session_id,'security.staff.manage');
 if s.role_snapshot<>'super_admin' then raise exception 'FORBIDDEN'; end if;
 return query select jsonb_build_object('schema_version',(select max(version) from private.schema_migrations),
  'database_name',current_database(),'database_flags',jsonb_build_object(
   'refunds',t.refunds_enabled,'returns',t.returns_enabled,'cash',t.cash_controls_enabled,
   'administration',t.administration_enabled,'partialPreview',t.partial_refund_preview_enabled,
   'partialRefunds',t.partial_refunds_enabled,'funding',t.funding_enabled),
  'funding_required',t.funding_required) from private.system_settings t where t.singleton;
end;
$$;

create function api.payment_display_items(p_session_id uuid,p_intent_id uuid) returns table(result jsonb)
language plpgsql security definer set search_path = '' as $$
declare s private.staff_sessions; i private.payment_intents; v_sale uuid;
begin
 s:=private.assert_session(p_session_id,'pos.checkout');
 select p.* into i from private.payment_intents p join private.staff_sessions owner_session on owner_session.id=p.staff_session_id
  where p.id=p_intent_id and owner_session.auth_user_id=s.auth_user_id and owner_session.terminal_id=s.terminal_id;
 if not found then raise exception 'NOT_FOUND'; end if;
 select sale.id into v_sale from private.sales sale where sale.payment_intent_id=i.id;
 if v_sale is not null then
  return query select coalesce(jsonb_agg(jsonb_build_object('name',l.product_name_snapshot,'quantity',l.quantity,'lineTotalWon',l.line_total_won) order by l.id),'[]'::jsonb)
   from private.sale_items l where l.sale_id=v_sale;
 else
  return query select coalesce(jsonb_agg(jsonb_build_object('name',p.name,'quantity',l.quantity,'lineTotalWon',l.line_total_won) order by l.id),'[]'::jsonb)
   from private.payment_intent_items l join public.products p on p.id=l.product_id where l.intent_id=i.id;
 end if;
end;
$$;

create table private.stock_adjustment_closures(
 idempotency_key uuid primary key,
 staff_user_id uuid not null references public.staff_profiles(auth_user_id) on delete restrict,
 created_at timestamptz not null default now()
);
create trigger immutable_stock_adjustment_closures before update or delete on private.stock_adjustment_closures
 for each row execute function private.reject_journal_mutation();
revoke all on private.stock_adjustment_closures from public,campuspay_runtime;

create or replace function api.remove_stock(
  p_session_id uuid,
  p_product_id uuid,
  p_lot_id uuid,
  p_quantity integer,
  p_reason_code text,
  p_notes text,
  p_idempotency_key uuid
)
returns table(reference_id uuid, reference_number text, created_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session private.staff_sessions;
  v_existing private.stock_adjustments;
  v_adjustment private.stock_adjustments;
  v_settings private.system_settings;
  v_lot private.inventory_lots;
  v_needed integer;
  v_take integer;
  v_cost bigint;
  v_total_cost bigint := 0;
  v_reference text;
  v_now timestamptz := now();
begin
  v_session := private.assert_session(p_session_id, 'inventory.adjust');
  if p_idempotency_key is null or p_product_id is null or p_quantity is null or p_quantity < 1 or p_reason_code is null or p_reason_code not in ('DAMAGED','EXPIRED','SUPPLIER_RETURN','STOCK_COUNT_LOSS')
     or p_notes is null or length(trim(p_notes)) not between 3 and 500 then raise exception 'BAD_REQUEST'; end if;
  if not exists(select 1 from public.products where id = p_product_id) then raise exception 'NOT_FOUND'; end if;

  perform pg_advisory_xact_lock(hashtextextended('stock-adjustment:'||p_idempotency_key::text,0));
  select * into v_existing from private.stock_adjustments where idempotency_key = p_idempotency_key;
  if found then
    if v_existing.adjusted_by is distinct from v_session.auth_user_id
      or v_existing.product_id is distinct from p_product_id or v_existing.requested_lot_id is distinct from p_lot_id
      or v_existing.quantity_removed is distinct from p_quantity or v_existing.reason_code is distinct from p_reason_code
      or v_existing.notes is distinct from trim(p_notes) then raise exception 'CONFLICT'; end if;
    return query select v_existing.id, v_existing.reference_number, v_existing.created_at;
    return;
  end if;

  if exists(select 1 from private.stock_adjustment_closures where idempotency_key=p_idempotency_key) then raise exception 'CONFLICT'; end if;

  if (select coalesce(sum(quantity_remaining),0) from private.inventory_lots
      where product_id = p_product_id and quantity_remaining > 0 and (p_lot_id is null or id = p_lot_id)) < p_quantity then
    raise exception 'INVENTORY_SHORTAGE';
  end if;

  select * into v_settings from private.system_settings where singleton;
  v_reference := 'ADJ-' || private.business_date_label(v_now) || '-' || lpad(nextval('private.adjustment_sequence')::text, 6, '0');
  insert into private.stock_adjustments(
    reference_number, product_id, requested_lot_id, quantity_removed, reason_code, notes,
    total_cost_won, adjusted_by, staff_session_id, idempotency_key
  ) values (
    v_reference, p_product_id, p_lot_id, p_quantity, p_reason_code, trim(p_notes),
    0, v_session.auth_user_id, v_session.id, p_idempotency_key
  ) returning * into v_adjustment;

  v_needed := p_quantity;
  for v_lot in
    select l.* from private.inventory_lots l
    where l.product_id = p_product_id and l.quantity_remaining > 0 and (p_lot_id is null or l.id = p_lot_id)
    order by
      case when p_lot_id is not null then 0 else 1 end,
      case when v_settings.inventory_cost_method = 'FIFO' then l.received_at end asc,
      case when v_settings.inventory_cost_method = 'FIFO' then l.id end asc,
      case when v_settings.inventory_cost_method = 'LIFO' then l.received_at end desc,
      case when v_settings.inventory_cost_method = 'LIFO' then l.id end desc
    for update
  loop
    exit when v_needed = 0;
    v_take := least(v_needed, v_lot.quantity_remaining);
    v_cost := round(v_take * v_lot.landed_unit_cost_won)::bigint;
    update private.inventory_lots set quantity_remaining = quantity_remaining - v_take where id = v_lot.id;
    insert into private.inventory_movements(
      product_id, lot_id, movement_type, quantity_change, unit_cost_won, total_cost_won,
      reason_code, notes, staff_user_id, staff_session_id, source_type, source_id, idempotency_key
    ) values (
      p_product_id, v_lot.id, p_reason_code::private.inventory_movement_type, -v_take,
      v_lot.landed_unit_cost_won, -v_cost, p_reason_code, trim(p_notes),
      v_session.auth_user_id, v_session.id, 'STOCK_ADJUSTMENT', v_adjustment.id,
      case when v_needed = p_quantity then p_idempotency_key else null end
    );
    v_total_cost := v_total_cost + v_cost;
    v_needed := v_needed - v_take;
  end loop;
  if v_needed <> 0 then raise exception 'INVENTORY_SHORTAGE'; end if;
  update private.stock_adjustments set total_cost_won = v_total_cost where id = v_adjustment.id;

  insert into private.audit_events(event_type, actor_user_id, staff_session_id, subject_type, subject_id, reference_number, safe_payload)
  values ('STOCK_ADJUSTMENT_POSTED', v_session.auth_user_id, v_session.id, 'STOCK_ADJUSTMENT', v_adjustment.id,
    'AUD-' || v_reference, jsonb_build_object('quantity', p_quantity, 'reason_code', p_reason_code, 'cost_won', v_total_cost));

  return query select v_adjustment.id, v_reference, v_now;
end;
$$;

create function api.recover_stock_adjustment(p_session_id uuid,p_idempotency_key uuid) returns table(result jsonb)
language plpgsql security definer set search_path = '' as $$
declare s private.staff_sessions; a private.stock_adjustments; c private.stock_adjustment_closures;
begin
 s:=private.assert_session(p_session_id,'inventory.adjust');
 if p_idempotency_key is null then raise exception 'BAD_REQUEST'; end if;
 perform pg_advisory_xact_lock(hashtextextended('stock-adjustment:'||p_idempotency_key::text,0));
 select * into a from private.stock_adjustments where idempotency_key=p_idempotency_key;
 if found then
  if a.adjusted_by<>s.auth_user_id then raise exception 'FORBIDDEN'; end if;
  return query select jsonb_build_object('state','POSTED','reference_id',a.id,'reference_number',a.reference_number,
   'created_at',a.created_at,'quantity_removed',a.quantity_removed,'total_cost_won',a.total_cost_won);
  return;
 end if;
 select * into c from private.stock_adjustment_closures where idempotency_key=p_idempotency_key;
 if found and c.staff_user_id<>s.auth_user_id then raise exception 'FORBIDDEN'; end if;
 insert into private.stock_adjustment_closures(idempotency_key,staff_user_id)
 values(p_idempotency_key,s.auth_user_id) on conflict do nothing;
 return query select jsonb_build_object('state','CLOSED');
end;
$$;
revoke all on function api.operator_readiness(uuid),api.payment_display_items(uuid,uuid),api.recover_stock_adjustment(uuid,uuid) from public;
grant execute on function api.operator_readiness(uuid),api.payment_display_items(uuid,uuid),api.recover_stock_adjustment(uuid,uuid) to campuspay_runtime;
insert into private.schema_migrations(version) values('20261002041000_operator_recovery') on conflict do nothing;
