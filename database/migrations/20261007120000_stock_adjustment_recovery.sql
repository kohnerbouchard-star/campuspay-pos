-- Stock removal recovery only. Forward migration after the frozen access/funding five.
-- Never rewrite historical journals, enable features or change credentials.
-- Preserve the established costing/lot allocation implementation behind the
-- strengthened idempotency boundary. It is never executable by the runtime.
alter function api.remove_stock(uuid,uuid,uuid,integer,text,text,uuid) set schema private;
alter function private.remove_stock(uuid,uuid,uuid,integer,text,text,uuid) rename to remove_stock_costed;
revoke all on function private.remove_stock_costed(uuid,uuid,uuid,integer,text,text,uuid) from public,campuspay_runtime;
create table private.stock_adjustment_closures(
  idempotency_key uuid primary key,
  staff_user_id uuid not null references public.staff_profiles(auth_user_id),
  terminal_id uuid not null references private.terminals(id),
  closed_at timestamptz not null default now()
);
create trigger immutable_stock_adjustment_closures before update or delete on private.stock_adjustment_closures
  for each row execute function private.reject_journal_mutation();
revoke all on private.stock_adjustment_closures from public,campuspay_runtime;

create or replace function api.remove_stock(
  p_session_id uuid,p_product_id uuid,p_lot_id uuid,p_quantity integer,
  p_reason_code text,p_notes text,p_idempotency_key uuid
)
returns table(reference_id uuid,reference_number text,created_at timestamptz)
language plpgsql security definer set search_path = '' as $$
declare v_session private.staff_sessions; v_existing private.stock_adjustments;
begin
  v_session := private.assert_session(p_session_id,'inventory.adjust');
  if p_idempotency_key is null or p_product_id is null or p_quantity is null or p_quantity<1
    or p_reason_code is null or p_reason_code not in ('DAMAGED','EXPIRED','SUPPLIER_RETURN','STOCK_COUNT_LOSS')
    or p_notes is null or length(trim(p_notes)) not between 3 and 500 then raise exception 'BAD_REQUEST'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_idempotency_key::text,40602));
  if exists(select 1 from private.stock_adjustment_closures where idempotency_key=p_idempotency_key) then
    raise exception 'CONFLICT: request closed without posting';
  end if;
  select * into v_existing from private.stock_adjustments where idempotency_key=p_idempotency_key;
  if found then
    if v_existing.adjusted_by is distinct from v_session.auth_user_id or not exists(
      select 1 from private.staff_sessions s where s.id=v_existing.staff_session_id and s.terminal_id=v_session.terminal_id
    ) then raise exception 'FORBIDDEN'; end if;
    if v_existing.product_id is distinct from p_product_id or v_existing.requested_lot_id is distinct from p_lot_id
      or v_existing.quantity_removed is distinct from p_quantity or v_existing.reason_code is distinct from p_reason_code
      or v_existing.notes is distinct from trim(p_notes) then raise exception 'CONFLICT: replay payload changed'; end if;
    return query select v_existing.id,v_existing.reference_number,v_existing.created_at;
    return;
  end if;
  return query select * from private.remove_stock_costed(p_session_id,p_product_id,p_lot_id,p_quantity,p_reason_code,trim(p_notes),p_idempotency_key);
end;
$$;

create or replace function api.recover_stock_adjustment(p_session_id uuid,p_idempotency_key uuid)
returns table(result jsonb)
language plpgsql security definer set search_path = '' as $$
declare
  v_session private.staff_sessions; v_existing private.stock_adjustments;
  v_closed private.stock_adjustment_closures;
begin
  v_session := private.assert_session(p_session_id,'inventory.adjust');
  if p_idempotency_key is null then raise exception 'BAD_REQUEST'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_idempotency_key::text,40602));
  select * into v_existing from private.stock_adjustments where idempotency_key=p_idempotency_key;
  if found then
    if v_existing.adjusted_by is distinct from v_session.auth_user_id or not exists(
      select 1 from private.staff_sessions s where s.id=v_existing.staff_session_id and s.terminal_id=v_session.terminal_id
    ) then raise exception 'FORBIDDEN'; end if;
    return query select jsonb_build_object('state','POSTED','idempotency_key',p_idempotency_key,
      'reference_id',v_existing.id,'reference_number',v_existing.reference_number,'created_at',v_existing.created_at,
      'quantity_removed',v_existing.quantity_removed,'total_cost_won',v_existing.total_cost_won);
    return;
  end if;
  select * into v_closed from private.stock_adjustment_closures where idempotency_key=p_idempotency_key;
  if found then
    if v_closed.staff_user_id is distinct from v_session.auth_user_id or v_closed.terminal_id is distinct from v_session.terminal_id then
      raise exception 'FORBIDDEN';
    end if;
    return query select jsonb_build_object('state','CLOSED','idempotency_key',p_idempotency_key);
    return;
  end if;
  insert into private.stock_adjustment_closures(idempotency_key,staff_user_id,terminal_id)
    values(p_idempotency_key,v_session.auth_user_id,v_session.terminal_id);
  insert into private.audit_events(event_type,actor_user_id,staff_session_id,subject_type,subject_id,reference_number,safe_payload)
    values('STOCK_REMOVAL_REQUEST_CLOSED',v_session.auth_user_id,v_session.id,'STOCK_ADJUSTMENT_REQUEST',p_idempotency_key,
      'AUD-ADJ-CLOSE-'||p_idempotency_key::text,'{}'::jsonb);
  return query select jsonb_build_object('state','CLOSED','idempotency_key',p_idempotency_key);
end;
$$;

revoke all on function api.remove_stock(uuid,uuid,uuid,integer,text,text,uuid) from public;
revoke all on function api.recover_stock_adjustment(uuid,uuid) from public;
grant execute on function api.remove_stock(uuid,uuid,uuid,integer,text,text,uuid) to campuspay_runtime;
grant execute on function api.recover_stock_adjustment(uuid,uuid) to campuspay_runtime;
