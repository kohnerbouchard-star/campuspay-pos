-- CampusPay online store, customer authentication, room delivery, and staff fulfillment.
-- Customer authentication uses the printed RFID/card number only as an identifier;
-- the raw number is fingerprinted by the application before it reaches PostgreSQL.

create type private.online_order_state as enum (
  'PLACED', 'PICKING', 'READY', 'OUT_FOR_DELIVERY', 'DELIVERED', 'CANCELLED'
);

create sequence if not exists private.online_order_sequence;

-- Existing financial journals allow a staff actor for register operations. Online-store
-- operations are system/customer initiated, so those actor fields are nullable there.
alter table private.sales alter column cashier_user_id drop not null;
alter table private.sales alter column staff_session_id drop not null;
alter table private.sales alter column payment_intent_id drop not null;
alter table private.sales add column channel text not null default 'POS'
  check (channel in ('POS', 'ONLINE_STORE'));

alter table private.wallet_ledger alter column staff_user_id drop not null;
alter table private.wallet_ledger alter column staff_session_id drop not null;
alter table private.inventory_movements alter column staff_user_id drop not null;
alter table private.inventory_movements alter column staff_session_id drop not null;
alter table private.coupon_redemptions alter column redeemed_by drop not null;
alter table private.coupon_redemptions alter column staff_session_id drop not null;

create table private.customer_sessions (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references private.students(id) on delete cascade,
  session_token_hash text not null unique check (length(session_token_hash) = 64),
  ip_fingerprint text not null check (length(ip_fingerprint) = 64),
  last_activity_at timestamptz not null default now(),
  expires_at timestamptz not null,
  max_expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  check (expires_at <= max_expires_at)
);
create index customer_sessions_active_idx on private.customer_sessions(student_id, expires_at)
  where revoked_at is null;

create table private.customer_login_limits (
  ip_fingerprint text primary key check (length(ip_fingerprint) = 64),
  window_started_at timestamptz not null default now(),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  locked_until timestamptz,
  updated_at timestamptz not null default now()
);

create table private.delivery_locations (
  id uuid primary key default gen_random_uuid(),
  building text not null check (building in ('East Building', 'West Building')),
  floor integer not null check (floor between 1 and 20),
  room text,
  orderable boolean not null default false,
  active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  unique nulls not distinct (building, floor, room),
  check (not orderable or room is not null)
);

insert into private.delivery_locations(building, floor, room, orderable, sort_order) values
  ('West Building', 2, null, false, 20),
  ('West Building', 3, null, false, 30),
  ('West Building', 4, null, false, 40),
  ('East Building', 2, '201', true, 201),
  ('East Building', 2, '202', true, 202),
  ('East Building', 2, '203', true, 203),
  ('East Building', 2, '204', true, 204),
  ('East Building', 2, '205', true, 205),
  ('East Building', 2, '206', true, 206)
on conflict (building, floor, room) do update
set orderable = excluded.orderable,
    active = true,
    sort_order = excluded.sort_order;

create table private.online_orders (
  id uuid primary key default gen_random_uuid(),
  order_number text not null unique,
  student_id uuid not null references private.students(id) on delete restrict,
  customer_session_id uuid not null references private.customer_sessions(id) on delete restrict,
  delivery_location_id uuid not null references private.delivery_locations(id) on delete restrict,
  delivery_building_snapshot text not null,
  delivery_floor_snapshot integer not null,
  delivery_room_snapshot text not null,
  delivery_note text,
  status private.online_order_state not null default 'PLACED',
  subtotal_won bigint not null check (subtotal_won > 0),
  discount_won bigint not null default 0 check (discount_won >= 0),
  total_won bigint not null check (total_won >= 0),
  coupon_id uuid references private.coupons(id) on delete restrict,
  coupon_name_snapshot text,
  coupon_code_masked text,
  balance_before_won bigint not null,
  balance_after_won bigint not null,
  sale_id uuid unique references private.sales(id) on delete restrict,
  idempotency_key uuid not null unique,
  delivered_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (subtotal_won = discount_won + total_won)
);
create index online_orders_student_created_idx on private.online_orders(student_id, created_at desc);
create index online_orders_fulfillment_idx on private.online_orders(status, created_at);

create table private.online_order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references private.online_orders(id) on delete restrict,
  product_id uuid not null references public.products(id) on delete restrict,
  product_name_snapshot text not null,
  quantity integer not null check (quantity > 0),
  unit_price_won bigint not null check (unit_price_won >= 0),
  line_total_won bigint not null check (line_total_won >= 0),
  cogs_won bigint not null default 0 check (cogs_won >= 0),
  unique(order_id, product_id)
);

create table private.online_order_status_events (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references private.online_orders(id) on delete restrict,
  from_status private.online_order_state,
  to_status private.online_order_state not null,
  source text not null check (source in ('CUSTOMER', 'STAFF', 'SYSTEM')),
  staff_user_id uuid references public.staff_profiles(auth_user_id) on delete restrict,
  staff_session_id uuid references private.staff_sessions(id) on delete restrict,
  created_at timestamptz not null default now()
);
create index online_order_status_events_order_idx on private.online_order_status_events(order_id, created_at);

revoke all on private.customer_sessions, private.customer_login_limits,
  private.delivery_locations, private.online_orders, private.online_order_items,
  private.online_order_status_events from public, campuspay_runtime;
revoke all on sequence private.online_order_sequence from public, campuspay_runtime;

create or replace function private.permissions_for_role(p_role public.staff_role)
returns text[]
language sql
immutable
set search_path = ''
as $$
  select case p_role
    when 'cashier' then array['pos.read','pos.checkout','coupons.redeem','orders.fulfill']::text[]
    when 'inventory_admin' then array[
      'inventory.read','inventory.receive','inventory.adjust','inventory.product.manage','inventory.price.manage',
      'coupons.manage','reports.inventory','security.credentials.request','orders.fulfill'
    ]::text[]
    when 'accountant' then array[
      'wallet.read','wallet.adjust','reports.sales','reports.inventory','reports.wallets','reports.coupons',
      'security.credentials.request'
    ]::text[]
    when 'super_admin' then array[
      'pos.read','pos.checkout','coupons.redeem',
      'inventory.read','inventory.receive','inventory.adjust','inventory.product.manage','inventory.price.manage',
      'coupons.manage','wallet.read','wallet.adjust',
      'reports.sales','reports.inventory','reports.wallets','reports.coupons',
      'security.credentials.request','security.step_up','security.credentials.reset','security.staff.manage',
      'orders.fulfill'
    ]::text[]
  end;
$$;

create or replace function private.assert_customer_session(p_session_id uuid)
returns private.customer_sessions
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session private.customer_sessions;
  v_student private.students;
begin
  select * into v_session
  from private.customer_sessions
  where id = p_session_id
  for update;

  if not found or v_session.revoked_at is not null or v_session.expires_at <= now() then
    raise exception 'SESSION_EXPIRED';
  end if;

  select * into v_student from private.students where id = v_session.student_id and active;
  if not found then raise exception 'FORBIDDEN'; end if;

  update private.customer_sessions
  set last_activity_at = now(),
      expires_at = least(max_expires_at, now() + interval '15 minutes')
  where id = v_session.id
  returning * into v_session;

  return v_session;
end;
$$;

create or replace function api.create_customer_session(
  p_card_fingerprint text,
  p_pin_proof text,
  p_session_token_hash text,
  p_ip_fingerprint text
)
returns table(
  session_id uuid,
  student_id uuid,
  display_name text,
  balance_won bigint,
  debt_won bigint,
  expires_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_student private.students;
  v_credential private.student_credentials;
  v_session private.customer_sessions;
  v_balance bigint;
  v_limit private.customer_login_limits;
  v_now timestamptz := now();
begin
  if p_card_fingerprint !~ '^[a-f0-9]{64}$'
     or p_pin_proof !~ '^[a-f0-9]{64}$'
     or p_session_token_hash !~ '^[a-f0-9]{64}$'
     or p_ip_fingerprint !~ '^[a-f0-9]{64}$' then
    return;
  end if;

  insert into private.customer_login_limits(ip_fingerprint)
  values (p_ip_fingerprint)
  on conflict (ip_fingerprint) do nothing;

  select * into v_limit
  from private.customer_login_limits
  where ip_fingerprint = p_ip_fingerprint
  for update;

  if v_limit.locked_until is not null and v_limit.locked_until > v_now then return; end if;
  if v_limit.window_started_at < v_now - interval '10 minutes' then
    update private.customer_login_limits
    set window_started_at = v_now, attempt_count = 0, locked_until = null, updated_at = v_now
    where ip_fingerprint = p_ip_fingerprint
    returning * into v_limit;
  end if;

  select s.* into v_student
  from private.student_cards c
  join private.students s on s.id = c.student_id
  where c.card_fingerprint = p_card_fingerprint and c.active and s.active;

  if not found then
    perform extensions.crypt(p_pin_proof, extensions.gen_salt('bf', 10));
    update private.customer_login_limits
    set attempt_count = attempt_count + 1,
        locked_until = case when attempt_count + 1 >= 10 then v_now + interval '10 minutes' else null end,
        updated_at = v_now
    where ip_fingerprint = p_ip_fingerprint;
    return;
  end if;

  select * into v_credential
  from private.student_credentials sc
  where sc.student_id = v_student.id
  for update;
  if not found then return; end if;
  if v_credential.locked_until is not null and v_credential.locked_until > v_now then return; end if;

  if extensions.crypt(p_pin_proof, v_credential.pin_hash) is distinct from v_credential.pin_hash then
    update private.student_credentials sc
    set failed_attempts = sc.failed_attempts + 1,
        locked_until = case when sc.failed_attempts + 1 >= 3 then v_now + interval '5 minutes' else null end
    where sc.student_id = v_student.id;
    update private.customer_login_limits
    set attempt_count = attempt_count + 1,
        locked_until = case when attempt_count + 1 >= 10 then v_now + interval '10 minutes' else null end,
        updated_at = v_now
    where ip_fingerprint = p_ip_fingerprint;
    return;
  end if;

  update private.student_credentials sc
  set failed_attempts = 0, locked_until = null
  where sc.student_id = v_student.id;
  update private.customer_login_limits
  set attempt_count = 0, locked_until = null, window_started_at = v_now, updated_at = v_now
  where ip_fingerprint = p_ip_fingerprint;

  update private.customer_sessions cs set revoked_at = v_now
  where cs.student_id = v_student.id and cs.revoked_at is null;

  insert into private.customer_sessions(
    student_id, session_token_hash, ip_fingerprint, expires_at, max_expires_at
  ) values (
    v_student.id, p_session_token_hash, p_ip_fingerprint,
    v_now + interval '15 minutes', v_now + interval '8 hours'
  ) returning * into v_session;

  select w.balance_won into v_balance from private.wallets w where w.student_id = v_student.id;
  if not found then raise exception 'NOT_FOUND'; end if;

  return query select v_session.id, v_student.id, v_student.display_name,
    v_balance, greatest(0::bigint, -v_balance), v_session.expires_at;
end;
$$;

create or replace function api.authorize_customer_session(p_session_token_hash text)
returns table(
  session_id uuid,
  student_id uuid,
  display_name text,
  balance_won bigint,
  debt_won bigint,
  expires_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session private.customer_sessions;
  v_student private.students;
  v_balance bigint;
begin
  select * into v_session
  from private.customer_sessions
  where session_token_hash = p_session_token_hash
  for update;
  if not found then raise exception 'SESSION_EXPIRED'; end if;
  v_session := private.assert_customer_session(v_session.id);
  select * into v_student from private.students where id = v_session.student_id and active;
  select w.balance_won into v_balance from private.wallets w where w.student_id = v_session.student_id;
  return query select v_session.id, v_student.id, v_student.display_name,
    v_balance, greatest(0::bigint, -v_balance), v_session.expires_at;
end;
$$;

create or replace function api.revoke_customer_session(p_session_token_hash text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update private.customer_sessions
  set revoked_at = now()
  where session_token_hash = p_session_token_hash and revoked_at is null;
end;
$$;

create or replace function api.store_catalog()
returns table(
  id uuid,
  sku text,
  name text,
  category text,
  selling_price_won bigint,
  stock_on_hand bigint,
  sold_out boolean
)
language sql
security definer
set search_path = ''
as $$
  select p.id, p.sku, p.name, p.category, p.selling_price_won,
    coalesce(sum(l.quantity_remaining), 0)::bigint,
    coalesce(sum(l.quantity_remaining), 0) <= 0
  from public.products p
  left join private.inventory_lots l on l.product_id = p.id and l.quantity_remaining > 0
  where p.active
  group by p.id, p.sku, p.name, p.category, p.selling_price_won
  order by p.category, p.name;
$$;

create or replace function api.store_delivery_locations()
returns table(
  location_id uuid,
  building text,
  floor integer,
  room text,
  orderable boolean
)
language sql
security definer
set search_path = ''
as $$
  select d.id, d.building, d.floor, d.room, d.orderable
  from private.delivery_locations d
  where d.active
  order by d.building, d.floor, d.sort_order, d.room;
$$;

create or replace function api.create_online_order(
  p_customer_session_id uuid,
  p_items jsonb,
  p_coupon_code_fingerprint text,
  p_delivery_location_id uuid,
  p_delivery_note text,
  p_idempotency_key uuid
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
  delivered_at timestamptz
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
    o.created_at, o.delivered_at
  from private.online_orders o
  where o.student_id = v_session.student_id
  order by o.created_at desc
  limit 50;
end;
$$;

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
  created_at timestamptz
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
    o.created_at
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

create or replace function api.update_online_order_status(
  p_session_id uuid,
  p_order_id uuid,
  p_next_status text
)
returns table(order_id uuid, order_number text, status text, updated_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session private.staff_sessions;
  v_order private.online_orders;
  v_next private.online_order_state;
  v_now timestamptz := now();
begin
  v_session := private.assert_session(p_session_id, 'orders.fulfill');
  if p_next_status not in ('PICKING','READY','OUT_FOR_DELIVERY','DELIVERED') then raise exception 'BAD_REQUEST'; end if;
  v_next := p_next_status::private.online_order_state;
  select * into v_order from private.online_orders where id = p_order_id for update;
  if not found then raise exception 'NOT_FOUND'; end if;

  if not (
    (v_order.status = 'PLACED' and v_next = 'PICKING') or
    (v_order.status = 'PICKING' and v_next = 'READY') or
    (v_order.status = 'READY' and v_next = 'OUT_FOR_DELIVERY') or
    (v_order.status = 'OUT_FOR_DELIVERY' and v_next = 'DELIVERED')
  ) then raise exception 'CONFLICT'; end if;

  update private.online_orders
  set status = v_next, updated_at = v_now,
      delivered_at = case when v_next = 'DELIVERED' then v_now else delivered_at end
  where id = v_order.id
  returning * into v_order;

  insert into private.online_order_status_events(
    order_id, from_status, to_status, source, staff_user_id, staff_session_id
  ) values (
    v_order.id,
    case v_next when 'PICKING' then 'PLACED'::private.online_order_state
                when 'READY' then 'PICKING'::private.online_order_state
                when 'OUT_FOR_DELIVERY' then 'READY'::private.online_order_state
                when 'DELIVERED' then 'OUT_FOR_DELIVERY'::private.online_order_state end,
    v_next, 'STAFF', v_session.auth_user_id, v_session.id
  );

  return query select v_order.id, v_order.order_number, v_order.status::text, v_order.updated_at;
end;
$$;

-- Customer sessions become invalid immediately after a card or PIN replacement.
create or replace function private.revoke_customer_sessions_on_card_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  update private.customer_sessions set revoked_at = now()
  where student_id = new.student_id and revoked_at is null;
  return new;
end;
$$;
create trigger revoke_customer_sessions_card_update
after update of active on private.student_cards
for each row execute function private.revoke_customer_sessions_on_card_change();
create trigger revoke_customer_sessions_card_insert
after insert on private.student_cards
for each row execute function private.revoke_customer_sessions_on_card_change();

create or replace function private.revoke_customer_sessions_on_pin_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  update private.customer_sessions set revoked_at = now()
  where student_id = new.student_id and revoked_at is null;
  return new;
end;
$$;
create trigger revoke_customer_sessions_pin_change
after update of pin_hash on private.student_credentials
for each row execute function private.revoke_customer_sessions_on_pin_change();

create trigger immutable_online_order_items
before update or delete on private.online_order_items
for each row execute function private.reject_journal_mutation();
create trigger immutable_online_order_status_events
before update or delete on private.online_order_status_events
for each row execute function private.reject_journal_mutation();

-- Add the sales channel to reporting while retaining existing report fields.
drop function api.report_sales(uuid, date, date);
create or replace function api.report_sales(
  p_session_id uuid,
  p_from date default null,
  p_to date default null
)
returns table(
  receipt_number text,
  sold_at timestamptz,
  cashier_name text,
  channel text,
  subtotal_won bigint,
  discount_won bigint,
  revenue_won bigint,
  cogs_won bigint,
  gross_profit_won bigint,
  coupon_name text,
  coupon_code_masked text,
  student_name text,
  balance_after_won bigint
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.assert_session(p_session_id, 'reports.sales');
  return query
  select s.receipt_number, s.created_at, coalesce(sp.display_name, 'Online Store'), s.channel,
    s.subtotal_won, s.discount_won, s.total_won,
    s.cost_of_goods_sold_won, s.total_won - s.cost_of_goods_sold_won,
    s.coupon_name_snapshot, s.coupon_code_masked,
    st.display_name, s.balance_after_won
  from private.sales s
  left join public.staff_profiles sp on sp.auth_user_id = s.cashier_user_id
  join private.students st on st.id = s.student_id
  where (p_from is null or s.created_at >= p_from::timestamptz)
    and (p_to is null or s.created_at < (p_to + 1)::timestamptz)
  order by s.created_at desc
  limit 5000;
end;
$$;

revoke all on function private.assert_customer_session(uuid) from public, campuspay_runtime;
revoke all on function private.revoke_customer_sessions_on_card_change() from public, campuspay_runtime;
revoke all on function private.revoke_customer_sessions_on_pin_change() from public, campuspay_runtime;
revoke all on function api.create_customer_session(text,text,text,text) from public;
revoke all on function api.authorize_customer_session(text) from public;
revoke all on function api.revoke_customer_session(text) from public;
revoke all on function api.store_catalog() from public;
revoke all on function api.store_delivery_locations() from public;
revoke all on function api.create_online_order(uuid,jsonb,text,uuid,text,uuid) from public;
revoke all on function api.customer_orders(uuid) from public;
revoke all on function api.staff_online_orders(uuid) from public;
revoke all on function api.update_online_order_status(uuid,uuid,text) from public;
revoke all on function api.report_sales(uuid,date,date) from public;

grant execute on function api.create_customer_session(text,text,text,text) to campuspay_runtime;
grant execute on function api.authorize_customer_session(text) to campuspay_runtime;
grant execute on function api.revoke_customer_session(text) to campuspay_runtime;
grant execute on function api.store_catalog() to campuspay_runtime;
grant execute on function api.store_delivery_locations() to campuspay_runtime;
grant execute on function api.create_online_order(uuid,jsonb,text,uuid,text,uuid) to campuspay_runtime;
grant execute on function api.customer_orders(uuid) to campuspay_runtime;
grant execute on function api.staff_online_orders(uuid) to campuspay_runtime;
grant execute on function api.update_online_order_status(uuid,uuid,text) to campuspay_runtime;
grant execute on function api.report_sales(uuid,date,date) to campuspay_runtime;

insert into private.schema_migrations(version)
values ('20260906160000_online_store')
on conflict (version) do nothing;
