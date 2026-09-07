-- MICA Money: authenticated catalog, authoritative order review, and fulfillment history.
-- No financial mutations are introduced by this migration.

drop function api.store_catalog();
create or replace function api.store_catalog(p_customer_session_id uuid)
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
  perform private.assert_customer_session(p_customer_session_id);
  return query
  select p.id, p.sku, p.name, p.category, p.selling_price_won,
    coalesce(sum(l.quantity_remaining), 0)::bigint,
    coalesce(sum(l.quantity_remaining), 0) <= 0
  from public.products p
  left join private.inventory_lots l on l.product_id = p.id and l.quantity_remaining > 0
  where p.active
  group by p.id, p.sku, p.name, p.category, p.selling_price_won
  order by p.category, p.name;
end;
$$;

drop function api.store_delivery_locations();
create or replace function api.store_delivery_locations(p_customer_session_id uuid)
returns table(
  location_id uuid,
  building text,
  floor integer,
  room text,
  orderable boolean
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.assert_customer_session(p_customer_session_id);
  return query
  select d.id, d.building, d.floor, d.room, d.orderable
  from private.delivery_locations d
  where d.active
  order by d.building, d.floor, d.sort_order, d.room;
end;
$$;

create or replace function api.quote_online_order(
  p_customer_session_id uuid,
  p_items jsonb,
  p_coupon_code_fingerprint text
)
returns table(
  subtotal_won bigint, discount_won bigint, total_won bigint,
  balance_before_won bigint, balance_after_won bigint,
  coupon_name text, coupon_code_masked text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session private.customer_sessions;
  v_coupon private.coupons;
  v_subtotal bigint;
  v_discount bigint := 0;
  v_balance bigint;
  v_limit bigint;
  v_count bigint;
begin
  v_session := private.assert_customer_session(p_customer_session_id);
  select coalesce(sum(c.line_total_won), 0)::bigint into v_subtotal
  from private.price_cart(p_items, true) c;
  if v_subtotal <= 0 then raise exception 'BAD_REQUEST'; end if;
  if p_coupon_code_fingerprint is not null then
    if p_coupon_code_fingerprint !~ '^[a-f0-9]{64}$' then raise exception 'COUPON_INVALID'; end if;
    select * into v_coupon from private.coupons where code_fingerprint = p_coupon_code_fingerprint;
    if not found then raise exception 'COUPON_INVALID'; end if;
    perform private.assert_coupon_window(v_coupon, v_subtotal);
    if v_coupon.per_student_limit is not null then
      select count(*) into v_count from private.coupon_redemptions
      where coupon_id = v_coupon.id and student_id = v_session.student_id;
      if v_count >= v_coupon.per_student_limit then raise exception 'COUPON_STUDENT_LIMIT'; end if;
    end if;
    v_discount := private.calculate_coupon_discount(v_coupon.discount_type,
      v_coupon.fixed_amount_won, v_coupon.percentage_bps, v_coupon.max_discount_won, v_subtotal);
  end if;
  select w.balance_won into v_balance from private.wallets w where w.student_id = v_session.student_id;
  if not found then raise exception 'NOT_FOUND'; end if;
  select negative_wallet_limit_won into v_limit from private.system_settings where singleton;
  if v_balance - (v_subtotal - v_discount) < v_limit then raise exception 'WALLET_LIMIT'; end if;
  return query select v_subtotal, v_discount, v_subtotal - v_discount,
    v_balance, v_balance - (v_subtotal - v_discount), v_coupon.name, v_coupon.code_masked;
end;
$$;

drop function api.customer_orders(uuid);
create or replace function api.customer_orders(p_customer_session_id uuid)
returns table(
  order_id uuid,
  order_number text,
  status text,
  subtotal_won bigint,
  discount_won bigint,
  total_won bigint,
  balance_after_won bigint,
  delivery_building text,
  delivery_floor integer,
  delivery_room text,
  delivery_note text,
  items jsonb,
  created_at timestamptz,
  delivered_at timestamptz,
  timeline jsonb
)
language plpgsql
security definer
set search_path = ''
as $$
declare v_session private.customer_sessions;
begin
  v_session := private.assert_customer_session(p_customer_session_id);
  return query
  select o.id, o.order_number, o.status::text, o.subtotal_won, o.discount_won,
    o.total_won, o.balance_after_won, o.delivery_building_snapshot,
    o.delivery_floor_snapshot, o.delivery_room_snapshot, o.delivery_note,
    coalesce((select jsonb_agg(jsonb_build_object(
      'product_id', i.product_id, 'name', i.product_name_snapshot, 'quantity', i.quantity,
      'unit_price_won', i.unit_price_won, 'line_total_won', i.line_total_won
    ) order by i.product_name_snapshot) from private.online_order_items i where i.order_id = o.id), '[]'::jsonb),
    o.created_at, o.delivered_at,
    coalesce((select jsonb_agg(jsonb_build_object(
      'status', e.to_status::text, 'created_at', e.created_at
    ) order by e.created_at, e.id) from private.online_order_status_events e
      where e.order_id = o.id), '[]'::jsonb)
  from private.online_orders o
  where o.student_id = v_session.student_id
  order by o.created_at desc
  limit 50;
end;
$$;

drop function api.staff_online_orders(uuid);
create or replace function api.staff_online_orders(p_session_id uuid)
returns table(
  order_id uuid,
  order_number text,
  status text,
  student_name text,
  total_won bigint,
  delivery_building text,
  delivery_floor integer,
  delivery_room text,
  delivery_note text,
  items jsonb,
  created_at timestamptz,
  timeline jsonb
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.assert_session(p_session_id, 'orders.fulfill');
  return query
  select o.id, o.order_number, o.status::text, s.display_name, o.total_won,
    o.delivery_building_snapshot, o.delivery_floor_snapshot, o.delivery_room_snapshot,
    o.delivery_note,
    coalesce((select jsonb_agg(jsonb_build_object(
      'product_id', i.product_id, 'name', i.product_name_snapshot, 'quantity', i.quantity,
      'unit_price_won', i.unit_price_won, 'line_total_won', i.line_total_won
    ) order by i.product_name_snapshot) from private.online_order_items i where i.order_id = o.id), '[]'::jsonb),
    o.created_at,
    coalesce((select jsonb_agg(jsonb_build_object(
      'status', e.to_status::text, 'created_at', e.created_at
    ) order by e.created_at, e.id) from private.online_order_status_events e
      where e.order_id = o.id), '[]'::jsonb)
  from private.online_orders o
  join private.students s on s.id = o.student_id
  where o.status <> 'CANCELLED'
  order by case o.status
      when 'PLACED' then 1 when 'PICKING' then 2 when 'READY' then 3
      when 'OUT_FOR_DELIVERY' then 4 when 'DELIVERED' then 5 else 6 end,
    o.created_at desc
  limit 200;
end;
$$;

revoke all on function api.store_catalog(uuid) from public;
grant execute on function api.store_catalog(uuid) to campuspay_runtime;

revoke all on function api.store_delivery_locations(uuid) from public;
grant execute on function api.store_delivery_locations(uuid) to campuspay_runtime;

revoke all on function api.quote_online_order(uuid,jsonb,text) from public;
grant execute on function api.quote_online_order(uuid,jsonb,text) to campuspay_runtime;

revoke all on function api.customer_orders(uuid) from public;
grant execute on function api.customer_orders(uuid) to campuspay_runtime;

revoke all on function api.staff_online_orders(uuid) from public;
grant execute on function api.staff_online_orders(uuid) to campuspay_runtime;

-- Keep the confirmed review amount stable if prices change before placement.
drop function api.create_online_order(uuid,jsonb,text,uuid,text,uuid);
create or replace function api.create_online_order(
  p_customer_session_id uuid,
  p_items jsonb,
  p_coupon_code_fingerprint text,
  p_delivery_location_id uuid,
  p_delivery_note text,
  p_idempotency_key uuid,
  p_expected_total_won bigint default null
)
returns table(
  order_id uuid,
  order_number text,
  status text,
  subtotal_won bigint,
  discount_won bigint,
  total_won bigint,
  balance_before_won bigint,
  balance_after_won bigint,
  debt_after_won bigint,
  coupon_name text,
  coupon_code_masked text,
  delivery_building text,
  delivery_floor integer,
  delivery_room text,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session private.customer_sessions;
  v_location private.delivery_locations;
  v_existing private.online_orders;
  v_order private.online_orders;
  v_wallet private.wallets;
  v_settings private.system_settings;
  v_coupon private.coupons;
  v_sale private.sales;
  v_priced record;
  v_item record;
  v_lot private.inventory_lots;
  v_sale_item_id uuid;
  v_subtotal bigint := 0;
  v_discount bigint := 0;
  v_projected bigint;
  v_needed integer;
  v_take integer;
  v_cost bigint;
  v_line_cogs bigint;
  v_all_cogs bigint := 0;
  v_ledger_id uuid;
  v_count bigint;
  v_number text;
  v_now timestamptz := now();
begin
  v_session := private.assert_customer_session(p_customer_session_id);
  if p_delivery_note is not null and length(p_delivery_note) > 240 then raise exception 'BAD_REQUEST'; end if;

  select * into v_existing from private.online_orders where idempotency_key = p_idempotency_key;
  if found then
    if v_existing.student_id <> v_session.student_id then raise exception 'CONFLICT'; end if;
    return query select v_existing.id, v_existing.order_number, v_existing.status::text,
      v_existing.subtotal_won, v_existing.discount_won, v_existing.total_won,
      v_existing.balance_before_won, v_existing.balance_after_won,
      greatest(0::bigint, -v_existing.balance_after_won),
      v_existing.coupon_name_snapshot, v_existing.coupon_code_masked,
      v_existing.delivery_building_snapshot, v_existing.delivery_floor_snapshot,
      v_existing.delivery_room_snapshot, v_existing.created_at;
    return;
  end if;

  select * into v_location
  from private.delivery_locations
  where id = p_delivery_location_id and active and orderable
  for share;
  if not found or v_location.room is null then raise exception 'BAD_REQUEST'; end if;

  -- Stabilize the price/name snapshots used by both pricing passes.
  perform p.id from public.products p
  where p.id in (select (entry->>'productId')::uuid from jsonb_array_elements(p_items) entry)
  order by p.id for share;

  select coalesce(sum(pc.line_total_won), 0)::bigint into v_subtotal
  from private.price_cart(p_items, true) pc;
  if v_subtotal <= 0 then raise exception 'BAD_REQUEST'; end if;

  if p_coupon_code_fingerprint is not null then
    if p_coupon_code_fingerprint !~ '^[a-f0-9]{64}$' then raise exception 'COUPON_INVALID'; end if;
    select * into v_coupon from private.coupons where code_fingerprint = p_coupon_code_fingerprint for update;
    if not found then raise exception 'COUPON_INVALID'; end if;
    perform private.assert_coupon_window(v_coupon, v_subtotal);
    if v_coupon.per_student_limit is not null then
      select count(*) into v_count from private.coupon_redemptions
      where coupon_id = v_coupon.id and student_id = v_session.student_id;
      if v_count >= v_coupon.per_student_limit then raise exception 'COUPON_STUDENT_LIMIT'; end if;
    end if;
    v_discount := private.calculate_coupon_discount(
      v_coupon.discount_type, v_coupon.fixed_amount_won, v_coupon.percentage_bps,
      v_coupon.max_discount_won, v_subtotal
    );
  end if;

  if p_expected_total_won is not null and p_expected_total_won <> v_subtotal - v_discount then
    raise exception 'CONFLICT';
  end if;

  select * into v_wallet from private.wallets where student_id = v_session.student_id for update;
  select * into v_settings from private.system_settings where singleton;
  v_projected := v_wallet.balance_won - (v_subtotal - v_discount);
  if v_projected < v_settings.negative_wallet_limit_won then raise exception 'WALLET_LIMIT'; end if;

  v_number := 'WEB-' || to_char(v_now, 'YYYYMMDD') || '-' || lpad(nextval('private.online_order_sequence')::text, 6, '0');
  insert into private.online_orders(
    order_number, student_id, customer_session_id, delivery_location_id,
    delivery_building_snapshot, delivery_floor_snapshot, delivery_room_snapshot, delivery_note,
    subtotal_won, discount_won, total_won, coupon_id, coupon_name_snapshot, coupon_code_masked,
    balance_before_won, balance_after_won, idempotency_key
  ) values (
    v_number, v_session.student_id, v_session.id, v_location.id,
    v_location.building, v_location.floor, v_location.room, nullif(trim(coalesce(p_delivery_note, '')), ''),
    v_subtotal, v_discount, v_subtotal - v_discount, v_coupon.id, v_coupon.name, v_coupon.code_masked,
    v_wallet.balance_won, v_projected, p_idempotency_key
  )
  on conflict (idempotency_key) do nothing
  returning * into v_order;

  if not found then
    select * into v_existing from private.online_orders where idempotency_key = p_idempotency_key;
    if not found or v_existing.student_id <> v_session.student_id then raise exception 'CONFLICT'; end if;
    return query select v_existing.id, v_existing.order_number, v_existing.status::text,
      v_existing.subtotal_won, v_existing.discount_won, v_existing.total_won,
      v_existing.balance_before_won, v_existing.balance_after_won,
      greatest(0::bigint, -v_existing.balance_after_won),
      v_existing.coupon_name_snapshot, v_existing.coupon_code_masked,
      v_existing.delivery_building_snapshot, v_existing.delivery_floor_snapshot,
      v_existing.delivery_room_snapshot, v_existing.created_at;
    return;
  end if;

  insert into private.sales(
    receipt_number, student_id, cashier_user_id, staff_session_id,
    subtotal_won, discount_won, total_won, coupon_id, coupon_name_snapshot, coupon_code_masked,
    balance_before_won, balance_after_won, payment_intent_id, channel
  ) values (
    v_number, v_session.student_id, null, null,
    v_subtotal, v_discount, v_subtotal - v_discount, v_coupon.id, v_coupon.name, v_coupon.code_masked,
    v_wallet.balance_won, v_projected, null, 'ONLINE_STORE'
  ) returning * into v_sale;

  for v_priced in select * from private.price_cart(p_items, true)
  loop
    insert into private.sale_items(
      sale_id, product_id, product_name_snapshot, quantity, unit_price_won, line_total_won
    ) values (
      v_sale.id, v_priced.product_id, v_priced.product_name, v_priced.quantity,
      v_priced.unit_price_won, v_priced.line_total_won
    ) returning id into v_sale_item_id;

    v_needed := v_priced.quantity;
    v_line_cogs := 0;
    for v_lot in
      select l.* from private.inventory_lots l
      where l.product_id = v_priced.product_id and l.quantity_remaining > 0
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
        v_priced.product_id, v_lot.id, 'SALE', -v_take, v_lot.landed_unit_cost_won, -v_cost,
        'ONLINE_STORE_ORDER', null, null, 'ONLINE_ORDER', v_order.id,
        case when v_needed = v_priced.quantity then p_idempotency_key else null end
      );
      v_line_cogs := v_line_cogs + v_cost;
      v_needed := v_needed - v_take;
    end loop;
    if v_needed <> 0 then raise exception 'INVENTORY_SHORTAGE'; end if;
    update private.sale_items set cogs_won = v_line_cogs where id = v_sale_item_id;
    insert into private.online_order_items(
      order_id, product_id, product_name_snapshot, quantity, unit_price_won, line_total_won, cogs_won
    ) values (
      v_order.id, v_priced.product_id, v_priced.product_name, v_priced.quantity,
      v_priced.unit_price_won, v_priced.line_total_won, v_line_cogs
    );
    v_all_cogs := v_all_cogs + v_line_cogs;
  end loop;

  if v_order.total_won > 0 then
    insert into private.wallet_ledger(
      reference_number, student_id, amount_won, entry_type, reason_code,
      balance_before_won, balance_after_won, staff_user_id, staff_session_id,
      source_type, source_id, idempotency_key, notes
    ) values (
      'PAY-' || v_number, v_session.student_id, -v_order.total_won, 'ONLINE_PURCHASE', 'ONLINE_STORE_ORDER',
      v_wallet.balance_won, v_projected, null, null, 'ONLINE_ORDER', v_order.id,
      p_idempotency_key, 'Online student store order'
    ) returning id into v_ledger_id;
    update private.wallets set balance_won = v_projected, updated_at = v_now where student_id = v_session.student_id;
  end if;

  update private.sales
  set cost_of_goods_sold_won = v_all_cogs, wallet_ledger_id = v_ledger_id
  where id = v_sale.id;
  update private.online_orders set sale_id = v_sale.id where id = v_order.id;

  if v_coupon.id is not null then
    insert into private.coupon_redemptions(
      coupon_id, sale_id, student_id, subtotal_won, discount_won, total_won,
      redeemed_by, staff_session_id
    ) values (
      v_coupon.id, v_sale.id, v_session.student_id, v_subtotal, v_discount,
      v_subtotal - v_discount, null, null
    );
  end if;

  insert into private.online_order_status_events(order_id, from_status, to_status, source)
  values (v_order.id, null, 'PLACED', 'CUSTOMER');

  insert into private.audit_events(
    event_type, actor_user_id, staff_session_id, subject_type, subject_id, reference_number, safe_payload
  ) values (
    'ONLINE_ORDER_PLACED', null, null, 'ONLINE_ORDER', v_order.id, 'AUD-' || v_number,
    jsonb_build_object(
      'order_number', v_number, 'total_won', v_order.total_won,
      'building', v_location.building, 'floor', v_location.floor, 'room', v_location.room,
      'coupon_code_masked', v_coupon.code_masked
    )
  );

  return query select v_order.id, v_order.order_number, v_order.status::text,
    v_order.subtotal_won, v_order.discount_won, v_order.total_won,
    v_order.balance_before_won, v_order.balance_after_won,
    greatest(0::bigint, -v_order.balance_after_won),
    v_order.coupon_name_snapshot, v_order.coupon_code_masked,
    v_order.delivery_building_snapshot, v_order.delivery_floor_snapshot,
    v_order.delivery_room_snapshot, v_order.created_at;
end;
$$;
revoke all on function api.create_online_order(uuid,jsonb,text,uuid,text,uuid,bigint) from public;
grant execute on function api.create_online_order(uuid,jsonb,text,uuid,text,uuid,bigint) to campuspay_runtime;
