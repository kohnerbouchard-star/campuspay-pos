create table if not exists private.stock_adjustments (
  id uuid primary key default gen_random_uuid(),
  reference_number text not null unique,
  product_id uuid not null references public.products(id) on delete restrict,
  requested_lot_id uuid references private.inventory_lots(id) on delete restrict,
  quantity_removed integer not null check (quantity_removed > 0),
  reason_code text not null check (reason_code in ('DAMAGED','EXPIRED','SUPPLIER_RETURN','STOCK_COUNT_LOSS')),
  notes text not null,
  total_cost_won bigint not null check (total_cost_won >= 0),
  adjusted_by uuid not null references public.staff_profiles(auth_user_id) on delete restrict,
  staff_session_id uuid not null references private.staff_sessions(id) on delete restrict,
  idempotency_key uuid not null unique,
  created_at timestamptz not null default now()
);
revoke all on private.stock_adjustments from public, campuspay_runtime;

create or replace function api.create_product(
  p_session_id uuid,
  p_sku text,
  p_name text,
  p_category text,
  p_selling_price_won bigint,
  p_reorder_level integer
)
returns table(reference_id uuid, reference_number text, created_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session private.staff_sessions;
  v_product public.products;
begin
  v_session := private.assert_session(p_session_id, 'inventory.product.manage');
  if length(trim(p_sku)) < 1 or length(trim(p_name)) < 1 or length(trim(p_category)) < 1
     or p_selling_price_won < 0 or p_reorder_level < 0 then raise exception 'BAD_REQUEST'; end if;

  insert into public.products(sku, name, category, selling_price_won, reorder_level, created_by)
  values (trim(p_sku), trim(p_name), trim(p_category), p_selling_price_won, p_reorder_level, v_session.auth_user_id)
  returning * into v_product;

  insert into private.audit_events(event_type, actor_user_id, staff_session_id, subject_type, subject_id, reference_number, safe_payload)
  values ('PRODUCT_CREATED', v_session.auth_user_id, v_session.id, 'PRODUCT', v_product.id,
    'AUD-PRODUCT-' || substr(v_product.id::text, 1, 8),
    jsonb_build_object('sku', v_product.sku, 'selling_price_won', v_product.selling_price_won));

  return query select v_product.id, 'PRODUCT-' || v_product.sku, v_product.created_at;
end;
$$;

create or replace function api.change_product_price(
  p_session_id uuid,
  p_product_id uuid,
  p_new_price_won bigint,
  p_reason text
)
returns table(reference_id uuid, reference_number text, created_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session private.staff_sessions;
  v_product public.products;
  v_history private.product_price_history;
begin
  v_session := private.assert_session(p_session_id, 'inventory.price.manage');
  if p_new_price_won < 0 or length(trim(p_reason)) < 3 then raise exception 'BAD_REQUEST'; end if;
  select * into v_product from public.products where id = p_product_id for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if v_product.selling_price_won = p_new_price_won then raise exception 'CONFLICT'; end if;

  insert into private.product_price_history(
    product_id, old_price_won, new_price_won, reason, changed_by, staff_session_id
  ) values (
    v_product.id, v_product.selling_price_won, p_new_price_won, trim(p_reason), v_session.auth_user_id, v_session.id
  ) returning * into v_history;

  update public.products set selling_price_won = p_new_price_won, updated_at = now() where id = v_product.id;
  return query select v_history.id, 'PRICE-' || substr(v_history.id::text, 1, 8), v_history.changed_at;
end;
$$;

create or replace function api.inventory_lots(p_session_id uuid)
returns table(
  lot_id uuid,
  product_id uuid,
  product_name text,
  receipt_number text,
  received_at timestamptz,
  expiration_date date,
  quantity_received integer,
  quantity_remaining integer,
  landed_unit_cost_won bigint,
  inventory_value_won bigint
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.assert_session_any(p_session_id, array['inventory.read','reports.inventory']);
  return query
  select l.id, l.product_id, p.name, r.receipt_number, l.received_at, l.expiration_date,
    l.quantity_received, l.quantity_remaining,
    round(l.landed_unit_cost_won)::bigint,
    round(l.quantity_remaining * l.landed_unit_cost_won)::bigint
  from private.inventory_lots l
  join public.products p on p.id = l.product_id
  join private.stock_receipt_lines rl on rl.id = l.receipt_line_id
  join private.stock_receipts r on r.id = rl.receipt_id
  order by p.name, l.received_at, l.id;
end;
$$;

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
      (select sum(quantity)::bigint from private.stock_receipt_lines where receipt_id = v_existing.id),
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
  if p_quantity < 1 or p_reason_code not in ('DAMAGED','EXPIRED','SUPPLIER_RETURN','STOCK_COUNT_LOSS')
     or length(trim(p_notes)) < 3 then raise exception 'BAD_REQUEST'; end if;
  if not exists(select 1 from public.products where id = p_product_id) then raise exception 'NOT_FOUND'; end if;

  select * into v_existing from private.stock_adjustments where idempotency_key = p_idempotency_key;
  if found then
    if v_existing.staff_session_id <> v_session.id then raise exception 'CONFLICT'; end if;
    return query select v_existing.id, v_existing.reference_number, v_existing.created_at;
    return;
  end if;

  if (select coalesce(sum(quantity_remaining),0) from private.inventory_lots
      where product_id = p_product_id and quantity_remaining > 0 and (p_lot_id is null or id = p_lot_id)) < p_quantity then
    raise exception 'INVENTORY_SHORTAGE';
  end if;

  select * into v_settings from private.system_settings where singleton;
  v_reference := 'ADJ-' || to_char(v_now, 'YYYYMMDD') || '-' || lpad(nextval('private.adjustment_sequence')::text, 6, '0');
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
      v_session.auth_user_id, v_session.id, 'STOCK_ADJUSTMENT', v_adjustment.id, p_idempotency_key
    );
    v_total_cost := v_total_cost + v_cost;
    v_needed := v_needed - v_take;
  end loop;
  if v_needed <> 0 then raise exception 'INVENTORY_SHORTAGE'; end if;
  update private.stock_adjustments set total_cost_won = v_total_cost where id = v_adjustment.id;

  insert into private.audit_events(event_type, actor_user_id, staff_session_id, subject_type, subject_id, reference_number, safe_payload)
  values ('STOCK_REMOVED', v_session.auth_user_id, v_session.id, 'STOCK_ADJUSTMENT', v_adjustment.id,
    'AUD-' || v_reference, jsonb_build_object('quantity', p_quantity, 'reason_code', p_reason_code, 'cost_won', v_total_cost));

  return query select v_adjustment.id, v_reference, v_now;
end;
$$;
