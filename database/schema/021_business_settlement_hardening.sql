-- Calendar semantics are school-wide and independent of the connection zone.
create or replace function private.business_timezone() returns text
language sql immutable set search_path = '' as $$ select 'Asia/Seoul'::text; $$;
create or replace function private.business_date(p_at timestamptz) returns date
language sql stable set search_path = '' as $$
  select (p_at at time zone private.business_timezone())::date;
$$;
create or replace function private.business_date_label(p_at timestamptz) returns text
language sql stable set search_path = '' as $$
  select to_char(private.business_date(p_at), 'YYYYMMDD');
$$;
revoke all on function private.business_timezone(), private.business_date(timestamptz), private.business_date_label(timestamptz) from public, campuspay_runtime;


-- A closed request cannot arrive late and settle after recovery reported no sale.
create table private.online_order_abandonments (
  idempotency_key uuid not null,
  student_id uuid not null references private.students(id),
  created_at timestamptz not null default now(),
  primary key(student_id, idempotency_key)
);
revoke all on private.online_order_abandonments from public, campuspay_runtime;

create or replace function api.recover_online_order(p_customer_session_id uuid, p_idempotency_key uuid)
returns table(
  order_id uuid, order_number text, status text, subtotal_won bigint,
  discount_won bigint, total_won bigint, balance_before_won bigint,
  balance_after_won bigint, debt_after_won bigint, coupon_name text,
  coupon_code_masked text, delivery_building text, delivery_floor integer,
  delivery_room text, created_at timestamptz
)
language plpgsql security definer set search_path = '' as $$
declare v_session private.customer_sessions; v_existing private.online_orders;
begin
  v_session := private.assert_customer_session(p_customer_session_id);
  if p_idempotency_key is null then raise exception 'BAD_REQUEST'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_idempotency_key::text, 31415));
  select * into v_existing from private.online_orders where idempotency_key = p_idempotency_key;
  if found then
    if v_existing.student_id <> v_session.student_id then raise exception 'FORBIDDEN'; end if;
    return query select v_existing.id, v_existing.order_number, v_existing.status::text,
      v_existing.subtotal_won, v_existing.discount_won, v_existing.total_won,
      v_existing.balance_before_won, v_existing.balance_after_won,
      greatest(0::bigint, -v_existing.balance_after_won),
      v_existing.coupon_name_snapshot, v_existing.coupon_code_masked,
      v_existing.delivery_building_snapshot, v_existing.delivery_floor_snapshot,
      v_existing.delivery_room_snapshot, v_existing.created_at;
    return;
  end if;
  insert into private.online_order_abandonments(idempotency_key, student_id)
  values(p_idempotency_key, v_session.student_id) on conflict do nothing;
end;
$$;
revoke all on function api.recover_online_order(uuid,uuid) from public;
grant execute on function api.recover_online_order(uuid,uuid) to campuspay_runtime;


-- Older deployments have different approved/error result columns for wallet
-- confirmation. Preserve the installed signature and all financial/PIN logic;
-- change only its date formatter. The guard fails closed on an unknown body.
do $business_dates$
declare signature text; definition text; pattern text := 'to_char\(v_now,\s*''YYYYMMDD''\)';
begin
  foreach signature in array array[
    'api.remove_stock(uuid,uuid,uuid,integer,text,text,uuid)',
    'api.confirm_wallet_adjustment(uuid,uuid,text)'
  ] loop
    definition := pg_get_functiondef(signature::regprocedure);
    if regexp_count(definition, pattern) <> 1 then raise exception 'DATE_PREFIX_CONTRACT_MISMATCH'; end if;
    execute regexp_replace(definition, pattern, 'private.business_date_label(v_now)', 'g');
  end loop;
end;
$business_dates$;


create or replace function api.confirm_payment(
  p_session_id uuid,
  p_intent_id uuid,
  p_student_pin_proof text,
  p_cash_received_won bigint default null
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
  created_at timestamptz,
  tender_mode text,
  wallet_tender_won bigint,
  cash_tender_won bigint,
  cash_received_won bigint,
  change_given_won bigint
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
  v_terminal private.terminals;
  v_cash_due bigint;
begin
  v_session := private.assert_session(p_session_id, 'pos.checkout');
  select * into v_intent from private.payment_intents where id = p_intent_id for update;
  if not found or v_intent.staff_session_id <> v_session.id then raise exception 'NOT_FOUND'; end if;

  if v_intent.state = 'completed' and v_intent.completed_sale_id is not null then
    return query
    select true, null::text, s.id, s.receipt_number,
      s.subtotal_won, s.discount_won, s.total_won,
      s.coupon_name_snapshot, s.coupon_code_masked,
      s.balance_before_won, s.balance_after_won, greatest(0::bigint, -s.balance_after_won),
      s.cost_of_goods_sold_won, s.created_at, v_intent.tender_mode, v_intent.wallet_amount_won, v_intent.total_won-v_intent.wallet_amount_won, v_intent.cash_received_won, v_intent.cash_received_won-(v_intent.total_won-v_intent.wallet_amount_won)
    from private.sales s
    where s.id = v_intent.completed_sale_id;
    return;
  end if;

  if v_intent.expires_at <= v_now then
    update private.payment_intents set state = 'expired', updated_at = v_now where id = v_intent.id;
    return query select false, 'SESSION_EXPIRED', null::uuid, null::text,
      v_intent.subtotal_won, v_intent.discount_won, v_intent.total_won,
      v_intent.coupon_name_snapshot, v_intent.coupon_code_masked,
      null::bigint, null::bigint, null::bigint, null::bigint, v_now, v_intent.tender_mode, v_intent.wallet_amount_won, v_intent.total_won-v_intent.wallet_amount_won, v_intent.cash_received_won, v_intent.cash_received_won-(v_intent.total_won-v_intent.wallet_amount_won);
    return;
  end if;

  if v_intent.wallet_amount_won is null then raise exception 'TENDER_INVALID'; end if;
  select * into v_terminal from private.terminals where id = v_session.terminal_id for share;
  v_cash_due := v_intent.total_won - v_intent.wallet_amount_won;
  if v_intent.tender_mode <> 'WALLET' and (not v_terminal.cash_enabled or v_terminal.cash_ends_at is null or v_terminal.cash_ends_at<=clock_timestamp()) then raise exception 'CASH_DISABLED'; end if;
  if v_intent.tender_mode <> 'WALLET' and (p_cash_received_won is null or p_cash_received_won < v_cash_due or p_cash_received_won > 1000000000) then raise exception 'CASH_UNDERPAYMENT'; end if;
  if v_intent.tender_mode = 'WALLET' and p_cash_received_won is not null then raise exception 'TENDER_INVALID'; end if;
  if v_intent.tender_mode = 'CASH' then
    if v_intent.state <> 'awaiting_card' or v_intent.student_id is not null then raise exception 'CONFLICT'; end if;
  else
    if v_intent.state <> 'awaiting_pin' or v_intent.student_id is null then raise exception 'CONFLICT'; end if;
    perform 1 from private.students s join private.student_cards c on c.student_id=s.id
      where s.id=v_intent.student_id and s.active and c.id=v_intent.student_card_id and c.active for share of s,c;
    if not found then raise exception 'NOT_FOUND'; end if;

  select * into v_credential from private.student_credentials where student_id = v_intent.student_id for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if v_credential.locked_until is not null and v_credential.locked_until > v_now then
    return query select false, 'RATE_LIMITED', null::uuid, null::text,
      v_intent.subtotal_won, v_intent.discount_won, v_intent.total_won,
      v_intent.coupon_name_snapshot, v_intent.coupon_code_masked,
      null::bigint, null::bigint, null::bigint, null::bigint, v_now, v_intent.tender_mode, v_intent.wallet_amount_won, v_intent.total_won-v_intent.wallet_amount_won, v_intent.cash_received_won, v_intent.cash_received_won-(v_intent.total_won-v_intent.wallet_amount_won);
    return;
  end if;

  if p_student_pin_proof is null or p_student_pin_proof !~ '^[a-f0-9]{64}$' or extensions.crypt(p_student_pin_proof, v_credential.pin_hash) is distinct from v_credential.pin_hash then
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
      null::bigint, null::bigint, null::bigint, null::bigint, v_now, v_intent.tender_mode, v_intent.wallet_amount_won, v_intent.total_won-v_intent.wallet_amount_won, v_intent.cash_received_won, v_intent.cash_received_won-(v_intent.total_won-v_intent.wallet_amount_won);
    return;
  end if;
  update private.student_credentials set failed_attempts = 0, locked_until = null where student_id = v_intent.student_id;

  end if; -- Wallet authentication; cash never accesses a credential.

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
        null::bigint, null::bigint, null::bigint, null::bigint, v_now, v_intent.tender_mode, v_intent.wallet_amount_won, v_intent.total_won-v_intent.wallet_amount_won, v_intent.cash_received_won, v_intent.cash_received_won-(v_intent.total_won-v_intent.wallet_amount_won);
      return;
    end if;

    if v_coupon.total_redemption_limit is not null then
      select count(*) into v_count from private.coupon_redemptions where coupon_id = v_coupon.id;
      if v_count >= v_coupon.total_redemption_limit then
        update private.payment_intents set state = 'cancelled', updated_at = v_now where id = v_intent.id;
        return query select false, 'COUPON_UNAVAILABLE', null::uuid, null::text,
          v_intent.subtotal_won, v_intent.discount_won, v_intent.total_won,
          v_intent.coupon_name_snapshot, v_intent.coupon_code_masked,
          null::bigint, null::bigint, null::bigint, null::bigint, v_now, v_intent.tender_mode, v_intent.wallet_amount_won, v_intent.total_won-v_intent.wallet_amount_won, v_intent.cash_received_won, v_intent.cash_received_won-(v_intent.total_won-v_intent.wallet_amount_won);
        return;
      end if;
    end if;

    if v_intent.tender_mode = 'CASH' and v_coupon.per_student_limit is not null then raise exception 'COUPON_IDENTITY_REQUIRED'; end if;
    if v_coupon.per_student_limit is not null then
      select count(*) into v_count
      from private.coupon_redemptions
      where coupon_id = v_coupon.id and student_id = v_intent.student_id;
      if v_count >= v_coupon.per_student_limit then
        update private.payment_intents set state = 'cancelled', updated_at = v_now where id = v_intent.id;
        return query select false, 'COUPON_STUDENT_LIMIT', null::uuid, null::text,
          v_intent.subtotal_won, v_intent.discount_won, v_intent.total_won,
          v_intent.coupon_name_snapshot, v_intent.coupon_code_masked,
          null::bigint, null::bigint, null::bigint, null::bigint, v_now, v_intent.tender_mode, v_intent.wallet_amount_won, v_intent.total_won-v_intent.wallet_amount_won, v_intent.cash_received_won, v_intent.cash_received_won-(v_intent.total_won-v_intent.wallet_amount_won);
        return;
      end if;
    end if;
  end if;

  select * into v_settings from private.system_settings where singleton;
  if v_intent.tender_mode <> 'CASH' then
  select * into v_wallet from private.wallets where student_id = v_intent.student_id for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  v_projected := v_wallet.balance_won - v_intent.wallet_amount_won;
  if v_projected < v_settings.negative_wallet_limit_won then
    update private.payment_intents set state = 'cancelled', updated_at = v_now where id = v_intent.id;
    return query select false, 'WALLET_LIMIT', null::uuid, null::text,
      v_intent.subtotal_won, v_intent.discount_won, v_intent.total_won,
      v_intent.coupon_name_snapshot, v_intent.coupon_code_masked,
      v_wallet.balance_won, v_projected, greatest(0::bigint, -v_projected), null::bigint, v_now, v_intent.tender_mode, v_intent.wallet_amount_won, v_intent.total_won-v_intent.wallet_amount_won, v_intent.cash_received_won, v_intent.cash_received_won-(v_intent.total_won-v_intent.wallet_amount_won);
    return;
  end if;

  end if; -- Cash has no wallet or projected wallet balance.

  -- Snapshot the confirmed cash received before the sale trigger creates tender journals.
  update private.payment_intents set cash_received_won = p_cash_received_won where id=v_intent.id;
  v_intent.cash_received_won := p_cash_received_won;

  if (select coalesce(sum(i.line_total_won),0) from private.payment_intent_items i where i.intent_id=v_intent.id)<>v_intent.subtotal_won then raise exception 'PRICE_CHANGED'; end if;

  -- Revalidate the authoritative product prices; reopen checkout if they changed.
  perform 1 from public.products p join private.payment_intent_items i on i.product_id=p.id
    where i.intent_id=v_intent.id order by p.id for share of p;
  if exists(select 1 from private.payment_intent_items i join public.products p on p.id=i.product_id
    where i.intent_id=v_intent.id and (not p.active or p.selling_price_won <> i.unit_price_won)) then raise exception 'PRICE_CHANGED'; end if;

  v_receipt := 'SALE-' || private.business_date_label(v_now) || '-' || lpad(nextval('private.sale_receipt_sequence')::text, 6, '0');
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
    order by pii.product_id
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

  if v_intent.wallet_amount_won > 0 then
    insert into private.wallet_ledger(
      reference_number, student_id, amount_won, entry_type, reason_code,
      balance_before_won, balance_after_won, staff_user_id, staff_session_id,
      source_type, source_id, idempotency_key
    ) values (
      'PAY-' || v_receipt, v_intent.student_id, -v_intent.wallet_amount_won, 'PURCHASE', 'POS_SALE',
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
      'cogs_won', v_all_cogs, 'tender_mode', v_intent.tender_mode,
      'wallet_tender_won', v_intent.wallet_amount_won, 'cash_tender_won', v_cash_due,
      'cash_received_won', p_cash_received_won, 'change_given_won', p_cash_received_won - v_cash_due,
      'terminal_id', v_session.terminal_id, 'event_name', v_terminal.cash_event_name, 'event_ends_at', v_terminal.cash_ends_at
    )
  );

  return query select true, null::text, v_sale.id, v_receipt,
    v_intent.subtotal_won, v_intent.discount_won, v_intent.total_won,
    v_intent.coupon_name_snapshot, v_intent.coupon_code_masked,
    v_wallet.balance_won, v_projected, greatest(0::bigint, -v_projected), v_all_cogs, v_now, v_intent.tender_mode, v_intent.wallet_amount_won, v_intent.total_won-v_intent.wallet_amount_won, v_intent.cash_received_won, v_intent.cash_received_won-(v_intent.total_won-v_intent.wallet_amount_won);
end;
$$;

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

  -- Recovery and placement serialize on the same opaque request key.
  perform pg_advisory_xact_lock(hashtextextended(p_idempotency_key::text, 31415));
  if exists(select 1 from private.online_order_abandonments where idempotency_key = p_idempotency_key and student_id = v_session.student_id) then raise exception 'CONFLICT'; end if;

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

  v_number := 'WEB-' || private.business_date_label(v_now) || '-' || lpad(nextval('private.online_order_sequence')::text, 6, '0');
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

  for v_priced in select * from private.price_cart(p_items, true) order by product_id
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

  -- Lock products in the common order; retain submitted line order for
  -- landed-cost rounding. Receiving inserts new lots and never locks old lots.
  perform p.id from public.products p
  where p.id in (select (entry->>'productId')::uuid from jsonb_array_elements(p_lines) entry)
  order by p.id for share;

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

  v_receipt_number := 'RCV-' || private.business_date_label(v_now) || '-' || lpad(nextval('private.stock_receipt_sequence')::text, 6, '0');
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

create or replace function api.report_sales(p_session_id uuid,p_from date default null,p_to date default null)
returns table(receipt_number text,sold_at timestamptz,cashier_name text,channel text,subtotal_won bigint,discount_won bigint,
 revenue_won bigint,cogs_won bigint,gross_profit_won bigint,coupon_name text,coupon_code_masked text,student_name text,balance_after_won bigint,
 tender_mode text,wallet_tender_won bigint,cash_tender_won bigint,cash_received_won bigint,change_given_won bigint)
language plpgsql security definer set search_path = '' as $$
begin
 perform private.assert_session(p_session_id,'reports.sales');
 return query select s.receipt_number,s.created_at,coalesce(sp.display_name,'Online Store'),s.channel,s.subtotal_won,s.discount_won,s.total_won,
  s.cost_of_goods_sold_won,s.total_won-s.cost_of_goods_sold_won,s.coupon_name_snapshot,s.coupon_code_masked,st.display_name,s.balance_after_won,
  case when tt.wallet_count>0 and tt.cash_count>0 then 'SPLIT' when tt.cash_count>0 then 'CASH' else 'WALLET' end,
  tt.wallet_won,tt.cash_won,tt.received,tt.change_won
 from private.sales s
 left join public.staff_profiles sp on sp.auth_user_id=s.cashier_user_id
 left join private.students st on st.id=s.student_id
 join lateral (select coalesce(sum(t.settled_amount_won) filter(where t.tender_type='WALLET'),0)::bigint wallet_won,
  coalesce(sum(t.settled_amount_won) filter(where t.tender_type='CASH'),0)::bigint cash_won,
  count(*) filter(where t.tender_type='WALLET') wallet_count,count(*) filter(where t.tender_type='CASH') cash_count,
  sum(t.cash_received_won)::bigint received,sum(t.change_given_won)::bigint change_won from private.sale_tenders t where t.sale_id=s.id) tt on true
 where (p_from is null or s.created_at>=(p_from::timestamp at time zone private.business_timezone())) and (p_to is null or s.created_at<((p_to+1)::timestamp at time zone private.business_timezone()))
 order by s.created_at desc;
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
    case when o.status <> 'DELIVERED' then o.created_at end asc,
    case when o.status = 'DELIVERED' then o.created_at end desc, o.id
  limit 200;
end;
$$;
