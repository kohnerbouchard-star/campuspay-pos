-- Read-only recovery for a stock receipt after the receiving staff member signs
-- back in on the same terminal. A missing row is an unknown result, not evidence
-- that a concurrent receipt transaction has failed or that it is safe to discard.
create or replace function api.recover_stock_receipt(p_session_id uuid,p_idempotency_key uuid)
returns table(receipt_id uuid,receipt_number text,total_quantity bigint,purchase_subtotal_won bigint,total_landed_cost_won bigint,created_at timestamptz)
language plpgsql security definer set search_path = '' as $$
declare s private.staff_sessions; r private.stock_receipts; original_terminal uuid;
begin
  s:=private.assert_session(p_session_id,'inventory.receive');
  if p_idempotency_key is null then raise exception 'BAD_REQUEST'; end if;
  select * into r from private.stock_receipts where idempotency_key=p_idempotency_key;
  if not found then return; end if;
  select terminal_id into original_terminal from private.staff_sessions where id=r.staff_session_id;
  if r.received_by is distinct from s.auth_user_id or original_terminal is distinct from s.terminal_id then raise exception 'FORBIDDEN'; end if;
  return query select r.id,r.receipt_number,(select coalesce(sum(sl.quantity),0)::bigint from private.stock_receipt_lines sl where sl.receipt_id=r.id),r.purchase_subtotal_won,r.total_landed_cost_won,r.created_at;
end;
$$;
revoke all on function api.recover_stock_receipt(uuid,uuid) from public;
grant execute on function api.recover_stock_receipt(uuid,uuid) to campuspay_runtime;
insert into private.schema_migrations(version) values('20260907200000_stock_receipt_recovery') on conflict do nothing;

-- Preserve the existing receipt settlement and session authority. Qualify the
-- replay projection so receipt_id resolves to the line table, not the OUT field.
create or replace function api.receive_stock(
  p_session_id uuid,
  p_supplier_name text,
  p_supplier_invoice text,
  p_purchase_date date,
  p_shipping_won bigint,
  p_other_costs_won bigint,
  p_discount_won bigint,
  p_notes text,
  p_lines jsonb,
  p_idempotency_key uuid
)
returns table(
  receipt_id uuid,
  receipt_number text,
  total_quantity bigint,
  purchase_subtotal_won bigint,
  total_landed_cost_won bigint,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session private.staff_sessions;
  v_existing private.stock_receipts;
  v_receipt private.stock_receipts;
  v_line record;
  v_product public.products;
  v_line_count integer;
  v_index integer := 0;
  v_total_quantity bigint := 0;
  v_subtotal bigint := 0;
  v_base bigint;
  v_weight bigint;
  v_weight_total bigint := 0;
  v_overhead_total bigint;
  v_overhead_alloc bigint;
  v_discount_alloc bigint;
  v_overhead_assigned bigint := 0;
  v_discount_assigned bigint := 0;
  v_line_landed bigint;
  v_line_id uuid;
  v_lot_id uuid;
  v_receipt_number text;
  v_now timestamptz := now();
begin
  v_session := private.assert_session(p_session_id, 'inventory.receive');
  if p_shipping_won < 0 or p_other_costs_won < 0 or p_discount_won < 0
     or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) < 1 or jsonb_array_length(p_lines) > 200
     or length(trim(p_supplier_name)) < 1 or length(trim(p_supplier_invoice)) < 1 then
    raise exception 'BAD_REQUEST';
  end if;

  select * into v_existing from private.stock_receipts where idempotency_key = p_idempotency_key;
  if found then
    if v_existing.staff_session_id <> v_session.id then raise exception 'CONFLICT'; end if;
    return query select v_existing.id, v_existing.receipt_number,
      (select sum(sl.quantity)::bigint from private.stock_receipt_lines sl where sl.receipt_id = v_existing.id),
      v_existing.purchase_subtotal_won, v_existing.total_landed_cost_won, v_existing.created_at;
    return;
  end if;

  v_line_count := jsonb_array_length(p_lines);
  for v_line in
    select entry, ordinality::integer as ordinal
    from jsonb_array_elements(p_lines) with ordinality as x(entry, ordinality)
  loop
    if (v_line.entry->>'quantity')::integer < 1 or (v_line.entry->>'purchaseUnitCostWon')::bigint < 0 then
      raise exception 'BAD_REQUEST';
    end if;
    select * into v_product from public.products where id = (v_line.entry->>'productId')::uuid and active;
    if not found then raise exception 'NOT_FOUND'; end if;
    v_base := (v_line.entry->>'quantity')::bigint * (v_line.entry->>'purchaseUnitCostWon')::bigint;
    v_subtotal := v_subtotal + v_base;
    v_total_quantity := v_total_quantity + (v_line.entry->>'quantity')::integer;
  end loop;
  v_weight_total := case when v_subtotal > 0 then v_subtotal else v_total_quantity end;
  v_overhead_total := p_shipping_won + p_other_costs_won;
  if p_discount_won > v_subtotal + v_overhead_total then raise exception 'BAD_REQUEST'; end if;

  v_receipt_number := 'RCV-' || to_char(v_now, 'YYYYMMDD') || '-' || lpad(nextval('private.stock_receipt_sequence')::text, 6, '0');
  insert into private.stock_receipts(
    receipt_number, supplier_name, supplier_invoice, purchase_date,
    purchase_subtotal_won, shipping_won, other_costs_won, discount_won, total_landed_cost_won,
    notes, received_by, staff_session_id, idempotency_key
  ) values (
    v_receipt_number, trim(p_supplier_name), trim(p_supplier_invoice), p_purchase_date,
    v_subtotal, p_shipping_won, p_other_costs_won, p_discount_won,
    v_subtotal + v_overhead_total - p_discount_won,
    nullif(trim(coalesce(p_notes,'')),''), v_session.auth_user_id, v_session.id, p_idempotency_key
  ) returning * into v_receipt;

  for v_line in
    select entry, ordinality::integer as ordinal
    from jsonb_array_elements(p_lines) with ordinality as x(entry, ordinality)
    order by ordinality
  loop
    v_index := v_index + 1;
    v_base := (v_line.entry->>'quantity')::bigint * (v_line.entry->>'purchaseUnitCostWon')::bigint;
    v_weight := case when v_subtotal > 0 then v_base else (v_line.entry->>'quantity')::bigint end;
    if v_index = v_line_count then
      v_overhead_alloc := v_overhead_total - v_overhead_assigned;
      v_discount_alloc := p_discount_won - v_discount_assigned;
    else
      v_overhead_alloc := floor(v_overhead_total::numeric * v_weight / v_weight_total)::bigint;
      v_discount_alloc := floor(p_discount_won::numeric * v_weight / v_weight_total)::bigint;
      v_overhead_assigned := v_overhead_assigned + v_overhead_alloc;
      v_discount_assigned := v_discount_assigned + v_discount_alloc;
    end if;
    v_line_landed := v_base + v_overhead_alloc - v_discount_alloc;
    if v_line_landed < 0 then raise exception 'BAD_REQUEST'; end if;

    insert into private.stock_receipt_lines(
      receipt_id, product_id, quantity, purchase_unit_cost_won, base_cost_won,
      allocated_overhead_won, allocated_discount_won, total_landed_cost_won,
      supplier_lot_code, expiration_date
    ) values (
      v_receipt.id, (v_line.entry->>'productId')::uuid, (v_line.entry->>'quantity')::integer,
      (v_line.entry->>'purchaseUnitCostWon')::bigint, v_base,
      v_overhead_alloc, v_discount_alloc, v_line_landed,
      nullif(trim(coalesce(v_line.entry->>'supplierLotCode','')),''),
      nullif(v_line.entry->>'expirationDate','')::date
    ) returning id into v_line_id;

    insert into private.inventory_lots(
      receipt_line_id, product_id, received_at, expiration_date,
      quantity_received, quantity_remaining, landed_unit_cost_won
    ) values (
      v_line_id, (v_line.entry->>'productId')::uuid, v_now,
      nullif(v_line.entry->>'expirationDate','')::date,
      (v_line.entry->>'quantity')::integer, (v_line.entry->>'quantity')::integer,
      v_line_landed::numeric / (v_line.entry->>'quantity')::integer
    ) returning id into v_lot_id;

    insert into private.inventory_movements(
      product_id, lot_id, movement_type, quantity_change, unit_cost_won, total_cost_won,
      reason_code, notes, staff_user_id, staff_session_id, source_type, source_id, idempotency_key
    ) values (
      (v_line.entry->>'productId')::uuid, v_lot_id, 'PURCHASE_RECEIPT',
      (v_line.entry->>'quantity')::integer,
      v_line_landed::numeric / (v_line.entry->>'quantity')::integer, v_line_landed,
      'PURCHASE_RECEIPT', p_notes, v_session.auth_user_id, v_session.id, 'STOCK_RECEIPT', v_receipt.id, p_idempotency_key
    );
  end loop;

  insert into private.audit_events(event_type, actor_user_id, staff_session_id, subject_type, subject_id, reference_number, safe_payload)
  values ('STOCK_RECEIPT_POSTED', v_session.auth_user_id, v_session.id, 'STOCK_RECEIPT', v_receipt.id,
    'AUD-' || v_receipt.receipt_number,
    jsonb_build_object('total_quantity', v_total_quantity, 'total_landed_cost_won', v_receipt.total_landed_cost_won));

  return query select v_receipt.id, v_receipt.receipt_number, v_total_quantity,
    v_receipt.purchase_subtotal_won, v_receipt.total_landed_cost_won, v_receipt.created_at;
end;
$$;
