-- Coupon module and coupon-aware checkout.
-- Raw coupon codes are never stored; only server-created HMAC fingerprints and masks reach Postgres.

create type private.coupon_discount_type as enum ('FIXED', 'PERCENTAGE');

create table private.coupons (
  id uuid primary key default gen_random_uuid(),
  idempotency_key uuid not null unique,
  name text not null check (length(name) between 2 and 120),
  code_fingerprint text not null unique check (length(code_fingerprint) = 64),
  code_masked text not null check (length(code_masked) between 4 and 20),
  discount_type private.coupon_discount_type not null,
  fixed_amount_won bigint,
  percentage_bps integer,
  minimum_subtotal_won bigint not null default 0 check (minimum_subtotal_won >= 0),
  max_discount_won bigint check (max_discount_won is null or max_discount_won > 0),
  total_redemption_limit integer check (total_redemption_limit is null or total_redemption_limit > 0),
  per_student_limit integer check (per_student_limit is null or per_student_limit > 0),
  starts_at timestamptz not null,
  ends_at timestamptz,
  active boolean not null default true,
  created_by uuid not null references auth.users(id) on delete restrict,
  staff_session_id uuid not null references private.staff_sessions(id) on delete restrict,
  deactivated_by uuid references auth.users(id) on delete restrict,
  deactivated_session_id uuid references private.staff_sessions(id) on delete restrict,
  deactivation_reason text,
  deactivated_at timestamptz,
  created_at timestamptz not null default now(),
  constraint coupon_terms_match_type check (
    (discount_type = 'FIXED' and fixed_amount_won > 0 and percentage_bps is null)
    or
    (discount_type = 'PERCENTAGE' and percentage_bps between 1 and 10000 and fixed_amount_won is null)
  ),
  constraint coupon_time_window_valid check (ends_at is null or ends_at > starts_at)
);
create index coupons_active_window_idx on private.coupons(active, starts_at, ends_at);

create table private.coupon_redemptions (
  id uuid primary key default gen_random_uuid(),
  coupon_id uuid not null references private.coupons(id) on delete restrict,
  sale_id uuid not null unique references private.sales(id) on delete restrict,
  student_id uuid not null references private.students(id) on delete restrict,
  subtotal_won bigint not null check (subtotal_won > 0),
  discount_won bigint not null check (discount_won > 0),
  total_won bigint not null check (total_won >= 0),
  redeemed_by uuid not null references auth.users(id) on delete restrict,
  staff_session_id uuid not null references private.staff_sessions(id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint coupon_redemption_math check (subtotal_won = discount_won + total_won)
);
create index coupon_redemptions_coupon_created_idx on private.coupon_redemptions(coupon_id, created_at desc);
create index coupon_redemptions_student_coupon_idx on private.coupon_redemptions(student_id, coupon_id);

alter table private.payment_intents add column subtotal_won bigint;
update private.payment_intents set subtotal_won = total_won where subtotal_won is null;
alter table private.payment_intents alter column subtotal_won set not null;
alter table private.payment_intents add constraint payment_intents_subtotal_positive check (subtotal_won > 0);
alter table private.payment_intents add column discount_won bigint not null default 0 check (discount_won >= 0);
alter table private.payment_intents add column coupon_id uuid references private.coupons(id) on delete restrict;
alter table private.payment_intents add column coupon_name_snapshot text;
alter table private.payment_intents add column coupon_code_masked text;
alter table private.payment_intents drop constraint payment_intents_total_won_check;
alter table private.payment_intents add constraint payment_intents_total_nonnegative check (total_won >= 0);
alter table private.payment_intents add constraint payment_intents_discount_math check (subtotal_won = discount_won + total_won);

alter table private.sales add column subtotal_won bigint;
update private.sales set subtotal_won = total_won where subtotal_won is null;
alter table private.sales alter column subtotal_won set not null;
alter table private.sales add constraint sales_subtotal_positive check (subtotal_won > 0);
alter table private.sales add column discount_won bigint not null default 0 check (discount_won >= 0);
alter table private.sales add column coupon_id uuid references private.coupons(id) on delete restrict;
alter table private.sales add column coupon_name_snapshot text;
alter table private.sales add column coupon_code_masked text;
alter table private.sales add column balance_before_won bigint;
alter table private.sales add column balance_after_won bigint;
update private.sales s
set balance_before_won = coalesce(
      (select wl.balance_before_won from private.wallet_ledger wl where wl.id = s.wallet_ledger_id),
      (select w.balance_won from private.wallets w where w.student_id = s.student_id),
      0
    ),
    balance_after_won = coalesce(
      (select wl.balance_after_won from private.wallet_ledger wl where wl.id = s.wallet_ledger_id),
      (select w.balance_won from private.wallets w where w.student_id = s.student_id),
      0
    )
where s.balance_before_won is null or s.balance_after_won is null;
update private.sales set balance_before_won = 0 where balance_before_won is null;
update private.sales set balance_after_won = 0 where balance_after_won is null;
alter table private.sales alter column balance_before_won set not null;
alter table private.sales alter column balance_after_won set not null;
alter table private.sales drop constraint sales_total_won_check;
alter table private.sales add constraint sales_total_nonnegative check (total_won >= 0);
alter table private.sales add constraint sales_discount_math check (subtotal_won = discount_won + total_won);

revoke all on private.coupons, private.coupon_redemptions from public, anon, authenticated;

create or replace function private.price_cart(p_items jsonb, p_check_stock boolean default true)
returns table(
  product_id uuid,
  product_name text,
  quantity integer,
  unit_price_won bigint,
  line_total_won bigint
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item record;
  v_product public.products;
  v_stock bigint;
begin
  if jsonb_typeof(p_items) <> 'array'
     or jsonb_array_length(p_items) = 0
     or jsonb_array_length(p_items) > 50 then
    raise exception 'BAD_REQUEST';
  end if;

  for v_item in
    select
      (entry->>'productId')::uuid as product_id,
      sum((entry->>'quantity')::integer)::integer as quantity
    from jsonb_array_elements(p_items) entry
    group by (entry->>'productId')::uuid
  loop
    if v_item.quantity < 1 or v_item.quantity > 99 then raise exception 'BAD_REQUEST'; end if;

    select * into v_product
    from public.products
    where id = v_item.product_id and active;
    if not found then raise exception 'NOT_FOUND'; end if;

    if p_check_stock then
      select coalesce(sum(l.quantity_remaining), 0) into v_stock
      from private.inventory_lots l
      where l.product_id = v_product.id and l.quantity_remaining > 0;
      if v_stock < v_item.quantity then raise exception 'INVENTORY_SHORTAGE'; end if;
    end if;

    product_id := v_product.id;
    product_name := v_product.name;
    quantity := v_item.quantity;
    unit_price_won := v_product.selling_price_won;
    line_total_won := v_product.selling_price_won * v_item.quantity;
    return next;
  end loop;
end;
$$;

create or replace function private.calculate_coupon_discount(
  p_discount_type private.coupon_discount_type,
  p_fixed_amount_won bigint,
  p_percentage_bps integer,
  p_max_discount_won bigint,
  p_subtotal_won bigint
)
returns bigint
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_discount bigint;
begin
  if p_subtotal_won <= 0 then return 0; end if;

  if p_discount_type = 'FIXED' then
    v_discount := p_fixed_amount_won;
  else
    v_discount := greatest(1::bigint, floor((p_subtotal_won::numeric * p_percentage_bps::numeric) / 10000)::bigint);
  end if;

  if p_max_discount_won is not null then
    v_discount := least(v_discount, p_max_discount_won);
  end if;

  return least(p_subtotal_won, greatest(0::bigint, v_discount));
end;
$$;

create or replace function private.assert_coupon_window(
  p_coupon private.coupons,
  p_subtotal_won bigint
)
returns void
language plpgsql
stable
set search_path = ''
as $$
begin
  if not p_coupon.active then raise exception 'COUPON_EXPIRED'; end if;
  if p_coupon.starts_at > now() then raise exception 'COUPON_EXPIRED'; end if;
  if p_coupon.ends_at is not null and p_coupon.ends_at <= now() then raise exception 'COUPON_EXPIRED'; end if;
  if p_subtotal_won < p_coupon.minimum_subtotal_won then raise exception 'COUPON_MINIMUM'; end if;
  if p_coupon.total_redemption_limit is not null
     and (select count(*) from private.coupon_redemptions cr where cr.coupon_id = p_coupon.id) >= p_coupon.total_redemption_limit then
    raise exception 'COUPON_LIMIT';
  end if;
end;
$$;

revoke all on function private.price_cart(jsonb, boolean) from public, anon, authenticated;
revoke all on function private.calculate_coupon_discount(private.coupon_discount_type, bigint, integer, bigint, bigint) from public, anon, authenticated;
revoke all on function private.assert_coupon_window(private.coupons, bigint) from public, anon, authenticated;

create or replace function api.create_coupon(
  p_session_id uuid,
  p_name text,
  p_code_fingerprint text,
  p_code_masked text,
  p_discount_type text,
  p_fixed_amount_won bigint,
  p_percentage_bps integer,
  p_minimum_subtotal_won bigint,
  p_max_discount_won bigint,
  p_total_redemption_limit integer,
  p_per_student_limit integer,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_idempotency_key uuid
)
returns table(
  coupon_id uuid,
  name text,
  code_masked text,
  active boolean,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session private.staff_sessions;
  v_coupon private.coupons;
begin
  v_session := private.assert_session(p_session_id, 'coupons.manage');

  select * into v_coupon from private.coupons where idempotency_key = p_idempotency_key;
  if found then
    if v_coupon.created_by <> v_session.auth_user_id then raise exception 'CONFLICT'; end if;
    return query select v_coupon.id, v_coupon.name, v_coupon.code_masked, v_coupon.active, v_coupon.created_at;
    return;
  end if;

  if length(p_code_fingerprint) <> 64
     or length(trim(p_name)) not between 2 and 120
     or p_discount_type not in ('FIXED', 'PERCENTAGE')
     or p_minimum_subtotal_won < 0
     or (p_ends_at is not null and p_ends_at <= p_starts_at) then
    raise exception 'BAD_REQUEST';
  end if;

  if exists (select 1 from private.coupons c where c.code_fingerprint = p_code_fingerprint) then
    raise exception 'CONFLICT';
  end if;

  insert into private.coupons(
    idempotency_key, name, code_fingerprint, code_masked, discount_type,
    fixed_amount_won, percentage_bps, minimum_subtotal_won, max_discount_won,
    total_redemption_limit, per_student_limit, starts_at, ends_at,
    created_by, staff_session_id
  ) values (
    p_idempotency_key, trim(p_name), p_code_fingerprint, p_code_masked, p_discount_type::private.coupon_discount_type,
    p_fixed_amount_won, p_percentage_bps, p_minimum_subtotal_won, p_max_discount_won,
    p_total_redemption_limit, p_per_student_limit, p_starts_at, p_ends_at,
    v_session.auth_user_id, v_session.id
  ) returning * into v_coupon;

  insert into private.audit_events(
    event_type, actor_user_id, staff_session_id, subject_type, subject_id, reference_number, safe_payload
  ) values (
    'COUPON_CREATED', v_session.auth_user_id, v_session.id, 'COUPON', v_coupon.id,
    'AUD-COUPON-' || v_coupon.id::text,
    jsonb_build_object(
      'name', v_coupon.name,
      'code_masked', v_coupon.code_masked,
      'discount_type', v_coupon.discount_type,
      'fixed_amount_won', v_coupon.fixed_amount_won,
      'percentage_bps', v_coupon.percentage_bps,
      'minimum_subtotal_won', v_coupon.minimum_subtotal_won,
      'max_discount_won', v_coupon.max_discount_won,
      'total_redemption_limit', v_coupon.total_redemption_limit,
      'per_student_limit', v_coupon.per_student_limit,
      'starts_at', v_coupon.starts_at,
      'ends_at', v_coupon.ends_at
    )
  );

  return query select v_coupon.id, v_coupon.name, v_coupon.code_masked, v_coupon.active, v_coupon.created_at;
exception
  when unique_violation then raise exception 'CONFLICT';
end;
$$;

create or replace function api.list_coupons(p_session_id uuid)
returns table(
  coupon_id uuid,
  name text,
  code_masked text,
  discount_type text,
  fixed_amount_won bigint,
  percentage_bps integer,
  minimum_subtotal_won bigint,
  max_discount_won bigint,
  total_redemption_limit integer,
  per_student_limit integer,
  redemption_count bigint,
  discount_given_won bigint,
  starts_at timestamptz,
  ends_at timestamptz,
  active boolean,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.assert_session(p_session_id, 'coupons.manage');
  return query
  select
    c.id, c.name, c.code_masked, c.discount_type::text, c.fixed_amount_won, c.percentage_bps,
    c.minimum_subtotal_won, c.max_discount_won, c.total_redemption_limit, c.per_student_limit,
    count(cr.id)::bigint, coalesce(sum(cr.discount_won), 0)::bigint,
    c.starts_at, c.ends_at, c.active, c.created_at
  from private.coupons c
  left join private.coupon_redemptions cr on cr.coupon_id = c.id
  group by c.id
  order by c.created_at desc;
end;
$$;

create or replace function api.deactivate_coupon(
  p_session_id uuid,
  p_coupon_id uuid,
  p_reason text
)
returns table(
  coupon_id uuid,
  name text,
  code_masked text,
  active boolean,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session private.staff_sessions;
  v_coupon private.coupons;
begin
  v_session := private.assert_session(p_session_id, 'coupons.manage');
  if length(trim(p_reason)) < 3 then raise exception 'BAD_REQUEST'; end if;

  select * into v_coupon from private.coupons where id = p_coupon_id for update;
  if not found then raise exception 'NOT_FOUND'; end if;

  if v_coupon.active then
    update private.coupons
    set active = false,
        deactivated_by = v_session.auth_user_id,
        deactivated_session_id = v_session.id,
        deactivation_reason = trim(p_reason),
        deactivated_at = now()
    where id = v_coupon.id
    returning * into v_coupon;

    insert into private.audit_events(
      event_type, actor_user_id, staff_session_id, subject_type, subject_id, reference_number, safe_payload
    ) values (
      'COUPON_DEACTIVATED', v_session.auth_user_id, v_session.id, 'COUPON', v_coupon.id,
      'AUD-COUPON-DEACTIVATE-' || v_coupon.id::text,
      jsonb_build_object('name', v_coupon.name, 'code_masked', v_coupon.code_masked, 'reason', trim(p_reason))
    );
  end if;

  return query select v_coupon.id, v_coupon.name, v_coupon.code_masked, v_coupon.active, v_coupon.created_at;
end;
$$;

create or replace function api.quote_coupon(
  p_session_id uuid,
  p_items jsonb,
  p_coupon_code_fingerprint text
)
returns table(
  coupon_id uuid,
  coupon_name text,
  code_masked text,
  subtotal_won bigint,
  discount_won bigint,
  total_won bigint
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_coupon private.coupons;
  v_subtotal bigint;
  v_discount bigint;
begin
  perform private.assert_session(p_session_id, 'coupons.redeem');
  if length(p_coupon_code_fingerprint) <> 64 then raise exception 'COUPON_INVALID'; end if;

  select coalesce(sum(pc.line_total_won), 0)::bigint into v_subtotal
  from private.price_cart(p_items, true) pc;
  if v_subtotal <= 0 then raise exception 'BAD_REQUEST'; end if;

  select * into v_coupon from private.coupons where code_fingerprint = p_coupon_code_fingerprint;
  if not found then raise exception 'COUPON_INVALID'; end if;
  perform private.assert_coupon_window(v_coupon, v_subtotal);

  v_discount := private.calculate_coupon_discount(
    v_coupon.discount_type,
    v_coupon.fixed_amount_won,
    v_coupon.percentage_bps,
    v_coupon.max_discount_won,
    v_subtotal
  );
  if v_discount <= 0 then raise exception 'COUPON_INVALID'; end if;

  return query select v_coupon.id, v_coupon.name, v_coupon.code_masked,
    v_subtotal, v_discount, v_subtotal - v_discount;
end;
$$;

-- Replace the original non-coupon payment-intent RPC with the coupon-aware signature.
drop function api.create_payment_intent(uuid, jsonb, uuid);

create or replace function api.create_payment_intent(
  p_session_id uuid,
  p_items jsonb,
  p_idempotency_key uuid,
  p_coupon_code_fingerprint text
)
returns table(
  intent_id uuid,
  state private.intent_state,
  subtotal_won bigint,
  discount_won bigint,
  total_won bigint,
  coupon_name text,
  coupon_code_masked text,
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
  v_priced record;
  v_coupon private.coupons;
  v_subtotal bigint;
  v_discount bigint := 0;
begin
  v_session := private.assert_session(p_session_id, 'pos.checkout');
  if p_coupon_code_fingerprint is not null
     and not private.role_has_permission(v_session.role_snapshot, 'coupons.redeem') then
    raise exception 'FORBIDDEN';
  end if;

  select * into v_existing from private.payment_intents where idempotency_key = p_idempotency_key;
  if found then
    if v_existing.staff_session_id <> v_session.id then raise exception 'CONFLICT'; end if;
    return query select
      v_existing.id, v_existing.state, v_existing.subtotal_won, v_existing.discount_won,
      v_existing.total_won, v_existing.coupon_name_snapshot, v_existing.coupon_code_masked,
      v_existing.expires_at;
    return;
  end if;

  select coalesce(sum(pc.line_total_won), 0)::bigint into v_subtotal
  from private.price_cart(p_items, true) pc;
  if v_subtotal <= 0 then raise exception 'BAD_REQUEST'; end if;

  if p_coupon_code_fingerprint is not null then
    if length(p_coupon_code_fingerprint) <> 64 then raise exception 'COUPON_INVALID'; end if;
    select * into v_coupon from private.coupons where code_fingerprint = p_coupon_code_fingerprint;
    if not found then raise exception 'COUPON_INVALID'; end if;
    perform private.assert_coupon_window(v_coupon, v_subtotal);
    v_discount := private.calculate_coupon_discount(
      v_coupon.discount_type,
      v_coupon.fixed_amount_won,
      v_coupon.percentage_bps,
      v_coupon.max_discount_won,
      v_subtotal
    );
    if v_discount <= 0 then raise exception 'COUPON_INVALID'; end if;
  end if;

  insert into private.payment_intents(
    idempotency_key, staff_session_id, subtotal_won, discount_won, total_won,
    coupon_id, coupon_name_snapshot, coupon_code_masked, state, expires_at
  ) values (
    p_idempotency_key, v_session.id, v_subtotal, v_discount, v_subtotal - v_discount,
    v_coupon.id, v_coupon.name, v_coupon.code_masked, 'awaiting_card', now() + interval '30 seconds'
  ) returning * into v_intent;

  for v_priced in select * from private.price_cart(p_items, true)
  loop
    insert into private.payment_intent_items(intent_id, product_id, quantity, unit_price_won, line_total_won)
    values (v_intent.id, v_priced.product_id, v_priced.quantity, v_priced.unit_price_won, v_priced.line_total_won);
  end loop;

  return query select
    v_intent.id, v_intent.state, v_intent.subtotal_won, v_intent.discount_won,
    v_intent.total_won, v_intent.coupon_name_snapshot, v_intent.coupon_code_masked,
    v_intent.expires_at;
end;
$$;

-- Replace checkout so coupon limits and redemption are committed with the sale.
drop function api.confirm_payment(uuid, uuid, text);

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
  subtotal_won bigint,
  discount_won bigint,
  total_won bigint,
  coupon_name text,
  coupon_code_masked text,
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
  v_coupon private.coupons;
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
  v_count bigint;
  v_now timestamptz := now();
begin
  v_session := private.assert_session(p_session_id, 'pos.checkout');
  select * into v_intent from private.payment_intents where id = p_intent_id for update;
  if not found or v_intent.staff_session_id <> v_session.id then raise exception 'NOT_FOUND'; end if;

  if v_intent.expires_at <= v_now then
    update private.payment_intents set state = 'expired', updated_at = v_now where id = v_intent.id;
    return query select false, 'SESSION_EXPIRED', null::uuid, null::text,
      v_intent.subtotal_won, v_intent.discount_won, v_intent.total_won,
      v_intent.coupon_name_snapshot, v_intent.coupon_code_masked,
      null::bigint, null::bigint, null::bigint, null::bigint, v_now;
    return;
  end if;

  if v_intent.state = 'completed' and v_intent.completed_sale_id is not null then
    return query
    select true, null::text, s.id, s.receipt_number,
      s.subtotal_won, s.discount_won, s.total_won,
      s.coupon_name_snapshot, s.coupon_code_masked,
      s.balance_before_won, s.balance_after_won, greatest(0::bigint, -s.balance_after_won),
      s.cost_of_goods_sold_won, s.created_at
    from private.sales s
    where s.id = v_intent.completed_sale_id;
    return;
  end if;

  if v_intent.state <> 'awaiting_pin' or v_intent.student_id is null then raise exception 'CONFLICT'; end if;

  select * into v_credential from private.student_credentials where student_id = v_intent.student_id for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if v_credential.locked_until is not null and v_credential.locked_until > v_now then
    return query select false, 'RATE_LIMITED', null::uuid, null::text,
      v_intent.subtotal_won, v_intent.discount_won, v_intent.total_won,
      v_intent.coupon_name_snapshot, v_intent.coupon_code_masked,
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
    return query select false, 'INVALID_PIN', null::uuid, null::text,
      v_intent.subtotal_won, v_intent.discount_won, v_intent.total_won,
      v_intent.coupon_name_snapshot, v_intent.coupon_code_masked,
      null::bigint, null::bigint, null::bigint, null::bigint, v_now;
    return;
  end if;
  update private.student_credentials set failed_attempts = 0, locked_until = null where student_id = v_intent.student_id;

  if v_intent.coupon_id is not null then
    select * into v_coupon from private.coupons where id = v_intent.coupon_id for update;
    if not found
       or not v_coupon.active
       or v_coupon.starts_at > v_now
       or (v_coupon.ends_at is not null and v_coupon.ends_at <= v_now) then
      update private.payment_intents set state = 'cancelled', updated_at = v_now where id = v_intent.id;
      return query select false, 'COUPON_UNAVAILABLE', null::uuid, null::text,
        v_intent.subtotal_won, v_intent.discount_won, v_intent.total_won,
        v_intent.coupon_name_snapshot, v_intent.coupon_code_masked,
        null::bigint, null::bigint, null::bigint, null::bigint, v_now;
      return;
    end if;

    if v_coupon.total_redemption_limit is not null then
      select count(*) into v_count from private.coupon_redemptions where coupon_id = v_coupon.id;
      if v_count >= v_coupon.total_redemption_limit then
        update private.payment_intents set state = 'cancelled', updated_at = v_now where id = v_intent.id;
        return query select false, 'COUPON_UNAVAILABLE', null::uuid, null::text,
          v_intent.subtotal_won, v_intent.discount_won, v_intent.total_won,
          v_intent.coupon_name_snapshot, v_intent.coupon_code_masked,
          null::bigint, null::bigint, null::bigint, null::bigint, v_now;
        return;
      end if;
    end if;

    if v_coupon.per_student_limit is not null then
      select count(*) into v_count
      from private.coupon_redemptions
      where coupon_id = v_coupon.id and student_id = v_intent.student_id;
      if v_count >= v_coupon.per_student_limit then
        update private.payment_intents set state = 'cancelled', updated_at = v_now where id = v_intent.id;
        return query select false, 'COUPON_STUDENT_LIMIT', null::uuid, null::text,
          v_intent.subtotal_won, v_intent.discount_won, v_intent.total_won,
          v_intent.coupon_name_snapshot, v_intent.coupon_code_masked,
          null::bigint, null::bigint, null::bigint, null::bigint, v_now;
        return;
      end if;
    end if;
  end if;

  select * into v_wallet from private.wallets where student_id = v_intent.student_id for update;
  select * into v_settings from private.system_settings where singleton;
  v_projected := v_wallet.balance_won - v_intent.total_won;
  if v_projected < v_settings.negative_wallet_limit_won then
    update private.payment_intents set state = 'cancelled', updated_at = v_now where id = v_intent.id;
    return query select false, 'WALLET_LIMIT', null::uuid, null::text,
      v_intent.subtotal_won, v_intent.discount_won, v_intent.total_won,
      v_intent.coupon_name_snapshot, v_intent.coupon_code_masked,
      v_wallet.balance_won, v_projected, greatest(0::bigint, -v_projected), null::bigint, v_now;
    return;
  end if;

  v_receipt := 'SALE-' || to_char(v_now, 'YYYYMMDD') || '-' || lpad(nextval('private.sale_receipt_sequence')::text, 6, '0');
  insert into private.sales(
    receipt_number, student_id, cashier_user_id, staff_session_id,
    subtotal_won, discount_won, total_won, coupon_id, coupon_name_snapshot, coupon_code_masked,
    balance_before_won, balance_after_won, payment_intent_id
  ) values (
    v_receipt, v_intent.student_id, v_session.auth_user_id, v_session.id,
    v_intent.subtotal_won, v_intent.discount_won, v_intent.total_won,
    v_intent.coupon_id, v_intent.coupon_name_snapshot, v_intent.coupon_code_masked,
    v_wallet.balance_won, v_projected, v_intent.id
  ) returning * into v_sale;

  for v_item in
    select pii.*, p.name as product_name
    from private.payment_intent_items pii
    join public.products p on p.id = pii.product_id
    where pii.intent_id = v_intent.id
    order by pii.id
  loop
    if (select coalesce(sum(quantity_remaining), 0) from private.inventory_lots where product_id = v_item.product_id and quantity_remaining > 0) < v_item.quantity then
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

  if v_intent.total_won > 0 then
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
  end if;

  update private.sales
  set cost_of_goods_sold_won = v_all_cogs, wallet_ledger_id = v_ledger_id
  where id = v_sale.id;

  if v_intent.coupon_id is not null then
    insert into private.coupon_redemptions(
      coupon_id, sale_id, student_id, subtotal_won, discount_won, total_won,
      redeemed_by, staff_session_id
    ) values (
      v_intent.coupon_id, v_sale.id, v_intent.student_id,
      v_intent.subtotal_won, v_intent.discount_won, v_intent.total_won,
      v_session.auth_user_id, v_session.id
    );
  end if;

  update private.payment_intents
  set state = 'completed', completed_sale_id = v_sale.id, updated_at = v_now
  where id = v_intent.id;

  insert into private.audit_events(
    event_type, actor_user_id, staff_session_id, subject_type, subject_id, reference_number, safe_payload
  ) values (
    'SALE_COMPLETED', v_session.auth_user_id, v_session.id, 'SALE', v_sale.id,
    'AUD-' || v_receipt,
    jsonb_build_object(
      'subtotal_won', v_intent.subtotal_won,
      'discount_won', v_intent.discount_won,
      'total_won', v_intent.total_won,
      'coupon_id', v_intent.coupon_id,
      'coupon_code_masked', v_intent.coupon_code_masked,
      'cogs_won', v_all_cogs
    )
  );

  return query select true, null::text, v_sale.id, v_receipt,
    v_intent.subtotal_won, v_intent.discount_won, v_intent.total_won,
    v_intent.coupon_name_snapshot, v_intent.coupon_code_masked,
    v_wallet.balance_won, v_projected, greatest(0::bigint, -v_projected), v_all_cogs, v_now;
end;
$$;

-- Replace sales reporting so discounts and coupon attribution remain visible.
drop function api.report_sales(uuid, date, date);

create or replace function api.report_sales(
  p_session_id uuid,
  p_from date default null,
  p_to date default null
)
returns table(
  receipt_number text,
  created_at timestamptz,
  cashier_name text,
  subtotal_won bigint,
  discount_won bigint,
  revenue_won bigint,
  cogs_won bigint,
  gross_profit_won bigint,
  coupon_name text,
  coupon_code_masked text,
  student_code text,
  balance_after_won bigint
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.assert_session(p_session_id, 'reports.sales');
  return query
  select s.receipt_number, s.created_at, sp.display_name,
    s.subtotal_won, s.discount_won, s.total_won,
    s.cost_of_goods_sold_won, s.total_won - s.cost_of_goods_sold_won,
    s.coupon_name_snapshot, s.coupon_code_masked,
    st.student_code, s.balance_after_won
  from private.sales s
  join public.staff_profiles sp on sp.auth_user_id = s.cashier_user_id
  join private.students st on st.id = s.student_id
  where (p_from is null or s.created_at >= p_from::timestamptz)
    and (p_to is null or s.created_at < (p_to + 1)::timestamptz)
  order by s.created_at desc
  limit 5000;
end;
$$;

create or replace function api.report_coupons(p_session_id uuid)
returns table(
  coupon_name text,
  code_masked text,
  redemption_count bigint,
  discount_given_won bigint,
  sales_revenue_won bigint,
  starts_at timestamptz,
  ends_at timestamptz,
  active boolean
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.assert_session(p_session_id, 'reports.coupons');
  return query
  select c.name, c.code_masked, count(cr.id)::bigint,
    coalesce(sum(cr.discount_won), 0)::bigint,
    coalesce(sum(cr.total_won), 0)::bigint,
    c.starts_at, c.ends_at, c.active
  from private.coupons c
  left join private.coupon_redemptions cr on cr.coupon_id = c.id
  group by c.id
  order by c.created_at desc;
end;
$$;

revoke all on function api.create_coupon(uuid, text, text, text, text, bigint, integer, bigint, bigint, integer, integer, timestamptz, timestamptz, uuid) from public, anon;
revoke all on function api.list_coupons(uuid) from public, anon;
revoke all on function api.deactivate_coupon(uuid, uuid, text) from public, anon;
revoke all on function api.quote_coupon(uuid, jsonb, text) from public, anon;
revoke all on function api.create_payment_intent(uuid, jsonb, uuid, text) from public, anon;
revoke all on function api.confirm_payment(uuid, uuid, text) from public, anon;
revoke all on function api.report_sales(uuid, date, date) from public, anon;
revoke all on function api.report_coupons(uuid) from public, anon;

grant execute on function api.create_coupon(uuid, text, text, text, text, bigint, integer, bigint, bigint, integer, integer, timestamptz, timestamptz, uuid) to authenticated;
grant execute on function api.list_coupons(uuid) to authenticated;
grant execute on function api.deactivate_coupon(uuid, uuid, text) to authenticated;
grant execute on function api.quote_coupon(uuid, jsonb, text) to authenticated;
grant execute on function api.create_payment_intent(uuid, jsonb, uuid, text) to authenticated;
grant execute on function api.confirm_payment(uuid, uuid, text) to authenticated;
grant execute on function api.report_sales(uuid, date, date) to authenticated;
grant execute on function api.report_coupons(uuid) to authenticated;
