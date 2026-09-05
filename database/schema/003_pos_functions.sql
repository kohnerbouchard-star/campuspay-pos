create or replace function api.catalog(p_session_id uuid)
returns table(
  id uuid,
  sku text,
  name text,
  category text,
  selling_price_won bigint,
  stock_on_hand bigint,
  sold_out boolean
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.assert_session_any(p_session_id, array['pos.read','inventory.read']);
  return query
  select
    p.id, p.sku, p.name, p.category, p.selling_price_won,
    coalesce(sum(l.quantity_remaining), 0)::bigint as stock_on_hand,
    coalesce(sum(l.quantity_remaining), 0) <= 0 as sold_out
  from public.products p
  left join private.inventory_lots l on l.product_id = p.id and l.quantity_remaining > 0
  where p.active
  group by p.id, p.sku, p.name, p.category, p.selling_price_won
  order by p.category, p.name;
end;
$$;

create or replace function api.create_payment_intent(
  p_session_id uuid,
  p_items jsonb,
  p_idempotency_key uuid
)
returns table(
  intent_id uuid,
  state private.intent_state,
  total_won bigint,
  expires_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session private.staff_sessions;
  v_existing private.payment_intents;
  v_intent private.payment_intents;
  v_item record;
  v_product public.products;
  v_total bigint := 0;
  v_stock bigint;
begin
  v_session := private.assert_session(p_session_id, 'pos.checkout');
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 or jsonb_array_length(p_items) > 50 then
    raise exception 'BAD_REQUEST';
  end if;

  select * into v_existing from private.payment_intents where idempotency_key = p_idempotency_key;
  if found then
    if v_existing.staff_session_id <> v_session.id then raise exception 'CONFLICT'; end if;
    return query select v_existing.id, v_existing.state, v_existing.total_won, v_existing.expires_at;
    return;
  end if;

  for v_item in
    select
      (entry->>'productId')::uuid as product_id,
      sum((entry->>'quantity')::integer)::integer as quantity
    from jsonb_array_elements(p_items) entry
    group by (entry->>'productId')::uuid
  loop
    if v_item.quantity < 1 or v_item.quantity > 99 then raise exception 'BAD_REQUEST'; end if;
    select * into v_product from public.products where id = v_item.product_id and active;
    if not found then raise exception 'NOT_FOUND'; end if;
    select coalesce(sum(quantity_remaining),0) into v_stock
      from private.inventory_lots where product_id = v_product.id and quantity_remaining > 0;
    if v_stock < v_item.quantity then raise exception 'INVENTORY_SHORTAGE'; end if;
    v_total := v_total + v_product.selling_price_won * v_item.quantity;
  end loop;
  if v_total <= 0 then raise exception 'BAD_REQUEST'; end if;

  insert into private.payment_intents(
    idempotency_key, staff_session_id, total_won, state, expires_at
  ) values (
    p_idempotency_key, v_session.id, v_total, 'awaiting_card', now() + interval '30 seconds'
  ) returning * into v_intent;

  for v_item in
    select
      (entry->>'productId')::uuid as product_id,
      sum((entry->>'quantity')::integer)::integer as quantity
    from jsonb_array_elements(p_items) entry
    group by (entry->>'productId')::uuid
  loop
    select * into v_product from public.products where id = v_item.product_id and active;
    insert into private.payment_intent_items(intent_id, product_id, quantity, unit_price_won, line_total_won)
    values (v_intent.id, v_product.id, v_item.quantity, v_product.selling_price_won, v_product.selling_price_won * v_item.quantity);
  end loop;

  return query select v_intent.id, v_intent.state, v_intent.total_won, v_intent.expires_at;
end;
$$;

create or replace function api.scan_payment_card(
  p_session_id uuid,
  p_intent_id uuid,
  p_card_fingerprint text
)
returns table(
  intent_id uuid,
  state private.intent_state,
  student_display_name text,
  current_balance_won bigint,
  projected_balance_won bigint,
  projected_debt_won bigint,
  expires_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session private.staff_sessions;
  v_intent private.payment_intents;
  v_student private.students;
  v_balance bigint;
  v_projected bigint;
begin
  v_session := private.assert_session(p_session_id, 'pos.checkout');
  select * into v_intent from private.payment_intents where id = p_intent_id for update;
  if not found or v_intent.staff_session_id <> v_session.id then raise exception 'NOT_FOUND'; end if;
  if v_intent.expires_at <= now() then
    update private.payment_intents set state = 'expired', updated_at = now() where id = v_intent.id;
    raise exception 'SESSION_EXPIRED';
  end if;
  if v_intent.state <> 'awaiting_card' then raise exception 'CONFLICT'; end if;

  select s.* into v_student
  from private.student_cards c
  join private.students s on s.id = c.student_id
  where c.card_fingerprint = p_card_fingerprint and c.active and s.active;
  if not found then raise exception 'NOT_FOUND'; end if;

  select balance_won into v_balance from private.wallets where student_id = v_student.id;
  if not found then raise exception 'NOT_FOUND'; end if;
  v_projected := v_balance - v_intent.total_won;

  update private.payment_intents
  set student_id = v_student.id, state = 'awaiting_pin', card_scanned_at = now(), updated_at = now()
  where id = v_intent.id;

  return query select
    v_intent.id, 'awaiting_pin'::private.intent_state, v_student.display_name,
    v_balance, v_projected, greatest(0::bigint, -v_projected), v_intent.expires_at;
end;
$$;

create or replace function api.confirm_payment(
  p_session_id uuid,
  p_intent_id uuid,
  p_student_pin_proof text
)
returns table(
  approved boolean,
  error_code text,
  sale_id uuid,
  receipt_number text,
  total_won bigint,
  balance_before_won bigint,
  balance_after_won bigint,
  debt_after_won bigint,
  cogs_won bigint,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session private.staff_sessions;
  v_intent private.payment_intents;
  v_credential private.student_credentials;
  v_wallet private.wallets;
  v_settings private.system_settings;
  v_sale private.sales;
  v_item record;
  v_lot private.inventory_lots;
  v_sale_item_id uuid;
  v_needed integer;
  v_take integer;
  v_line_cogs bigint;
  v_all_cogs bigint := 0;
  v_cost bigint;
  v_projected bigint;
  v_ledger_id uuid;
  v_receipt text;
  v_now timestamptz := now();
begin
  v_session := private.assert_session(p_session_id, 'pos.checkout');
  select * into v_intent from private.payment_intents where id = p_intent_id for update;
  if not found or v_intent.staff_session_id <> v_session.id then raise exception 'NOT_FOUND'; end if;
  if v_intent.expires_at <= v_now then
    update private.payment_intents set state = 'expired', updated_at = v_now where id = v_intent.id;
    return query select false, 'SESSION_EXPIRED', null::uuid, null::text, v_intent.total_won,
      null::bigint, null::bigint, null::bigint, null::bigint, v_now;
    return;
  end if;
  if v_intent.state = 'completed' and v_intent.completed_sale_id is not null then
    return query
    select true, null::text, s.id, s.receipt_number, s.total_won,
      wl.balance_before_won, wl.balance_after_won, greatest(0::bigint, -wl.balance_after_won),
      s.cost_of_goods_sold_won, s.created_at
    from private.sales s join private.wallet_ledger wl on wl.id = s.wallet_ledger_id
    where s.id = v_intent.completed_sale_id;
    return;
  end if;
  if v_intent.state <> 'awaiting_pin' or v_intent.student_id is null then raise exception 'CONFLICT'; end if;

  select * into v_credential from private.student_credentials where student_id = v_intent.student_id for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if v_credential.locked_until is not null and v_credential.locked_until > v_now then
    return query select false, 'RATE_LIMITED', null::uuid, null::text, v_intent.total_won,
      null::bigint, null::bigint, null::bigint, null::bigint, v_now;
    return;
  end if;

  if extensions.crypt(p_student_pin_proof, v_credential.pin_hash) <> v_credential.pin_hash then
    update private.student_credentials
    set failed_attempts = failed_attempts + 1,
        locked_until = case when failed_attempts + 1 >= 3 then v_now + interval '5 minutes' else null end
    where student_id = v_intent.student_id;
    update private.payment_intents
    set pin_attempts = least(3, pin_attempts + 1),
        state = case when pin_attempts + 1 >= 3 then 'cancelled'::private.intent_state else state end,
        updated_at = v_now
    where id = v_intent.id;
    return query select false, 'INVALID_PIN', null::uuid, null::text, v_intent.total_won,
      null::bigint, null::bigint, null::bigint, null::bigint, v_now;
    return;
  end if;
  update private.student_credentials set failed_attempts = 0, locked_until = null where student_id = v_intent.student_id;

  select * into v_wallet from private.wallets where student_id = v_intent.student_id for update;
  select * into v_settings from private.system_settings where singleton;
  v_projected := v_wallet.balance_won - v_intent.total_won;
  if v_projected < v_settings.negative_wallet_limit_won then
    update private.payment_intents set state = 'cancelled', updated_at = v_now where id = v_intent.id;
    return query select false, 'WALLET_LIMIT', null::uuid, null::text, v_intent.total_won,
      v_wallet.balance_won, v_projected, greatest(0::bigint, -v_projected), null::bigint, v_now;
    return;
  end if;

  v_receipt := 'SALE-' || to_char(v_now, 'YYYYMMDD') || '-' || lpad(nextval('private.sale_receipt_sequence')::text, 6, '0');
  insert into private.sales(
    receipt_number, student_id, cashier_user_id, staff_session_id, total_won, payment_intent_id
  ) values (
    v_receipt, v_intent.student_id, v_session.auth_user_id, v_session.id, v_intent.total_won, v_intent.id
  ) returning * into v_sale;

  for v_item in
    select pii.*, p.name as product_name
    from private.payment_intent_items pii
    join public.products p on p.id = pii.product_id
    where pii.intent_id = v_intent.id
    order by pii.id
  loop
    if (select coalesce(sum(quantity_remaining),0) from private.inventory_lots where product_id = v_item.product_id and quantity_remaining > 0) < v_item.quantity then
      raise exception 'INVENTORY_SHORTAGE';
    end if;

    insert into private.sale_items(
      sale_id, product_id, product_name_snapshot, quantity, unit_price_won, line_total_won
    ) values (
      v_sale.id, v_item.product_id, v_item.product_name, v_item.quantity, v_item.unit_price_won, v_item.line_total_won
    ) returning id into v_sale_item_id;

    v_needed := v_item.quantity;
    v_line_cogs := 0;
    for v_lot in
      select l.* from private.inventory_lots l
      where l.product_id = v_item.product_id and l.quantity_remaining > 0
      order by
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
      insert into private.sale_cost_allocations(sale_item_id, inventory_lot_id, quantity, unit_cost_won, total_cost_won)
      values (v_sale_item_id, v_lot.id, v_take, v_lot.landed_unit_cost_won, v_cost);
      insert into private.inventory_movements(
        product_id, lot_id, movement_type, quantity_change, unit_cost_won, total_cost_won,
        reason_code, staff_user_id, staff_session_id, source_type, source_id, idempotency_key
      ) values (
        v_item.product_id, v_lot.id, 'SALE', -v_take, v_lot.landed_unit_cost_won, -v_cost,
        'STUDENT_SALE', v_session.auth_user_id, v_session.id, 'SALE_ITEM', v_sale_item_id, v_intent.idempotency_key
      );
      v_line_cogs := v_line_cogs + v_cost;
      v_needed := v_needed - v_take;
    end loop;
    if v_needed <> 0 then raise exception 'INVENTORY_SHORTAGE'; end if;
    update private.sale_items set cogs_won = v_line_cogs where id = v_sale_item_id;
    v_all_cogs := v_all_cogs + v_line_cogs;
  end loop;

  insert into private.wallet_ledger(
    reference_number, student_id, amount_won, entry_type, reason_code,
    balance_before_won, balance_after_won, staff_user_id, staff_session_id,
    source_type, source_id, idempotency_key
  ) values (
    'PAY-' || v_receipt, v_intent.student_id, -v_intent.total_won, 'PURCHASE', 'POS_SALE',
    v_wallet.balance_won, v_projected, v_session.auth_user_id, v_session.id,
    'SALE', v_sale.id, v_intent.idempotency_key
  ) returning id into v_ledger_id;

  update private.wallets set balance_won = v_projected, updated_at = v_now where student_id = v_intent.student_id;
  update private.sales set cost_of_goods_sold_won = v_all_cogs, wallet_ledger_id = v_ledger_id where id = v_sale.id;
  update private.payment_intents set state = 'completed', completed_sale_id = v_sale.id, updated_at = v_now where id = v_intent.id;

  insert into private.audit_events(event_type, actor_user_id, staff_session_id, subject_type, subject_id, reference_number, safe_payload)
  values ('SALE_COMPLETED', v_session.auth_user_id, v_session.id, 'SALE', v_sale.id,
          'AUD-' || v_receipt, jsonb_build_object('total_won', v_intent.total_won, 'cogs_won', v_all_cogs));

  return query select true, null::text, v_sale.id, v_receipt, v_intent.total_won,
    v_wallet.balance_won, v_projected, greatest(0::bigint, -v_projected), v_all_cogs, v_now;
end;
$$;
