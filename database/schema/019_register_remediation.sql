-- Bounded event cash and card-first split preparation. Apply only to approved database branches.
alter table private.terminals add column cash_ends_at timestamptz;
-- Legacy enabled events fail closed until an administrator supplies an end time.
alter table private.payment_intents alter column wallet_amount_won drop not null;
alter table private.payment_intents drop constraint payment_intent_tender_plan;
alter table private.payment_intents add constraint payment_intent_tender_plan check (
 (tender_mode='SPLIT' and wallet_amount_won is null and cash_received_won is null and state <> 'completed') or
 (wallet_amount_won is not null and wallet_amount_won between 0 and total_won and
  ((tender_mode='WALLET' and wallet_amount_won=total_won and cash_received_won is null)
   or (tender_mode='CASH' and wallet_amount_won=0)
   or (tender_mode='SPLIT' and wallet_amount_won>0 and wallet_amount_won<total_won)) and
  (cash_received_won is null or cash_received_won between total_won-wallet_amount_won and 1000000000))
);
drop function api.set_terminal_payment_policy(uuid,boolean,text);
drop function api.terminal_payment_policy(uuid);
create function api.terminal_payment_policy_v2(p_session_id uuid)
returns table(terminal_label text,cash_enabled boolean,event_name text,can_manage boolean,ends_at timestamptz,event_status text)
language plpgsql security definer set search_path = '' as $$
declare s private.staff_sessions;
begin
 s:=private.assert_session(p_session_id,'pos.read');
 return query select coalesce(t.label,'This register'),
  t.cash_enabled and coalesce(t.cash_ends_at>clock_timestamp(),false),t.cash_event_name,s.role_snapshot='super_admin'::public.staff_role,t.cash_ends_at,
  case when not t.cash_enabled then 'OFF' when coalesce(t.cash_ends_at>clock_timestamp(),false) then 'ACTIVE' else 'EXPIRED' end
 from private.terminals t where t.id=s.terminal_id;
end;
$$;
create function api.set_terminal_payment_policy(p_session_id uuid,p_cash_enabled boolean,p_event_name text,p_ends_at timestamptz)
returns table(terminal_label text,cash_enabled boolean,event_name text,can_manage boolean,ends_at timestamptz,event_status text)
language plpgsql security definer set search_path = '' as $$
declare s private.staff_sessions; old_t private.terminals; event_label text;
begin
 s:=private.assert_session(p_session_id,'security.staff.manage');
 if s.role_snapshot<>'super_admin' then raise exception 'FORBIDDEN'; end if;
 event_label:=nullif(trim(p_event_name),'');
 if p_cash_enabled is null or (p_cash_enabled and (event_label is null or length(event_label) not between 2 and 80
  or p_ends_at is null or p_ends_at<=clock_timestamp() or p_ends_at>clock_timestamp()+interval '24 hours')) then raise exception 'BAD_REQUEST'; end if;
 select * into old_t from private.terminals where id=s.terminal_id for update;
 update private.terminals set cash_enabled=p_cash_enabled,cash_event_name=case when p_cash_enabled then event_label else null end,
  cash_ends_at=case when p_cash_enabled then p_ends_at else null end where id=s.terminal_id;
 insert into private.audit_events(event_type,actor_user_id,staff_session_id,subject_type,subject_id,reference_number,safe_payload)
 values('TERMINAL_PAYMENT_POLICY_CHANGED',s.auth_user_id,s.id,'TERMINAL',s.terminal_id,'AUD-CASH-'||gen_random_uuid()::text,
 jsonb_build_object('scope','TERMINAL','old_cash_enabled',old_t.cash_enabled,'new_cash_enabled',p_cash_enabled,
 'old_event_name',old_t.cash_event_name,'new_event_name',case when p_cash_enabled then event_label else null end,
 'old_ends_at',old_t.cash_ends_at,'new_ends_at',case when p_cash_enabled then p_ends_at else null end,
 'old_effective_cash_enabled',old_t.cash_enabled and coalesce(old_t.cash_ends_at>clock_timestamp(),false)));
 return query select * from api.terminal_payment_policy_v2(s.id);
end;
$$;

create or replace function api.create_payment_intent(
  p_session_id uuid,
  p_items jsonb,
  p_idempotency_key uuid,
  p_coupon_code_fingerprint text,
  p_tender_mode text default 'WALLET',
  p_wallet_amount_won bigint default null
)
returns table(
  intent_id uuid,
  state private.intent_state,
  subtotal_won bigint,
  discount_won bigint,
  total_won bigint,
  coupon_name text,
  coupon_code_masked text,
  expires_at timestamptz,
  tender_mode text,
  wallet_tender_won bigint,
  cash_tender_won bigint
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
  v_wallet_amount bigint;
  v_terminal private.terminals;
begin
  v_session := private.assert_session(p_session_id, 'pos.checkout');
  if p_tender_mode is null or p_tender_mode not in ('WALLET','CASH','SPLIT') then raise exception 'BAD_REQUEST'; end if;
  select * into v_terminal from private.terminals where id = v_session.terminal_id for share;
  if p_tender_mode <> 'WALLET' and (not v_terminal.cash_enabled or v_terminal.cash_ends_at is null or v_terminal.cash_ends_at<=clock_timestamp()) then raise exception 'CASH_DISABLED'; end if;
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
      v_existing.expires_at, v_existing.tender_mode, v_existing.wallet_amount_won, v_existing.total_won - v_existing.wallet_amount_won;
    return;
  end if;

  -- Keep both price_cart reads on one product-price snapshot while creating the proposal.
  if p_items is null or jsonb_typeof(p_items)<>'array' then raise exception 'BAD_REQUEST'; end if;
  perform 1 from public.products p
    where p.id in (select (entry->>'productId')::uuid from jsonb_array_elements(p_items) entry)
    order by p.id for share of p;
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

  v_wallet_amount := case when p_tender_mode = 'WALLET' then v_subtotal - v_discount when p_tender_mode = 'CASH' then 0 else p_wallet_amount_won end;
  if (v_wallet_amount is null and p_tender_mode <> 'SPLIT') or v_wallet_amount < 0 or v_wallet_amount > v_subtotal - v_discount
     or (p_tender_mode = 'SPLIT' and (v_wallet_amount = 0 or v_wallet_amount = v_subtotal - v_discount)) then raise exception 'TENDER_INVALID'; end if;
  if p_tender_mode = 'CASH' and v_coupon.per_student_limit is not null then raise exception 'COUPON_IDENTITY_REQUIRED'; end if;

  insert into private.payment_intents(
    idempotency_key, staff_session_id, subtotal_won, discount_won, total_won,
    coupon_id, coupon_name_snapshot, coupon_code_masked, state, expires_at, tender_mode, wallet_amount_won
  ) values (
    p_idempotency_key, v_session.id, v_subtotal, v_discount, v_subtotal - v_discount,
    v_coupon.id, v_coupon.name, v_coupon.code_masked, 'awaiting_card', now() + interval '2 minutes', p_tender_mode, v_wallet_amount
  ) returning * into v_intent;

  for v_priced in select * from private.price_cart(p_items, true)
  loop
    insert into private.payment_intent_items(intent_id, product_id, quantity, unit_price_won, line_total_won)
    values (v_intent.id, v_priced.product_id, v_priced.quantity, v_priced.unit_price_won, v_priced.line_total_won);
  end loop;

  return query select
    v_intent.id, v_intent.state, v_intent.subtotal_won, v_intent.discount_won,
    v_intent.total_won, v_intent.coupon_name_snapshot, v_intent.coupon_code_masked,
    v_intent.expires_at, v_intent.tender_mode, v_intent.wallet_amount_won, v_intent.total_won - v_intent.wallet_amount_won;
end;
$$;

drop function api.scan_payment_card(uuid,uuid,text);
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
  expires_at timestamptz,
  minimum_balance_won bigint,
  maximum_wallet_won bigint
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
  v_floor bigint;
begin
  v_session := private.assert_session(p_session_id, 'pos.checkout');
  select * into v_intent from private.payment_intents where id = p_intent_id for update;
  if not found or v_intent.staff_session_id <> v_session.id then raise exception 'NOT_FOUND'; end if;
  if v_intent.expires_at <= now() then
    update private.payment_intents set state = 'expired', updated_at = now() where id = v_intent.id;
    raise exception 'SESSION_EXPIRED';
  end if;
  if v_intent.tender_mode = 'CASH' or v_intent.state <> 'awaiting_card' then raise exception 'CONFLICT'; end if;

  select s.* into v_student
  from private.student_cards c
  join private.students s on s.id = c.student_id
  where c.card_fingerprint = p_card_fingerprint and c.active and s.active;
  if not found then raise exception 'NOT_FOUND'; end if;

  select balance_won into v_balance from private.wallets where student_id = v_student.id;
  if not found then raise exception 'NOT_FOUND'; end if;
  select negative_wallet_limit_won into v_floor from private.system_settings where singleton;
  v_projected := v_balance - coalesce(v_intent.wallet_amount_won,0);

  update private.payment_intents
  set student_card_id = (select c.id from private.student_cards c where c.card_fingerprint = p_card_fingerprint and c.active), student_id = v_student.id, state = 'awaiting_pin', card_scanned_at = now(), updated_at = now()
  where id = v_intent.id;

  return query select
    v_intent.id, 'awaiting_pin'::private.intent_state, v_student.display_name,
    v_balance, v_projected, greatest(0::bigint, -v_projected), v_intent.expires_at, v_floor, least(v_intent.total_won,greatest(0::bigint,v_balance-v_floor));
end;
$$;

-- Preparation only: bind the plan once after identifying the card, without PIN or ledger/stock writes.
create function api.finalize_payment_tender(p_session_id uuid,p_intent_id uuid,p_wallet_amount_won bigint)
returns table(intent_id uuid,state private.intent_state,subtotal_won bigint,discount_won bigint,total_won bigint,
 coupon_name text,coupon_code_masked text,expires_at timestamptz,tender_mode text,wallet_tender_won bigint,cash_tender_won bigint)
language plpgsql security definer set search_path = '' as $$
declare s private.staff_sessions; i private.payment_intents; t private.terminals; capacity bigint;
begin
 s:=private.assert_session(p_session_id,'pos.checkout');
 select * into i from private.payment_intents where id=p_intent_id for update;
 if not found or i.staff_session_id<>s.id then raise exception 'NOT_FOUND'; end if;
 if i.expires_at<=clock_timestamp() then raise exception 'SESSION_EXPIRED'; end if;
 if i.state<>'awaiting_pin' or i.student_id is null then raise exception 'CONFLICT'; end if;
 if i.wallet_amount_won is not null then
  if i.wallet_amount_won is distinct from p_wallet_amount_won then raise exception 'CONFLICT'; end if;
 else
  if i.tender_mode<>'SPLIT' then raise exception 'CONFLICT'; end if;
  select * into t from private.terminals where id=s.terminal_id for share;
  if p_wallet_amount_won is distinct from i.total_won and (not t.cash_enabled or t.cash_ends_at is null or t.cash_ends_at<=clock_timestamp()) then raise exception 'CASH_DISABLED'; end if;
  perform 1 from private.students st join private.student_cards c on c.student_id=st.id
   where st.id=i.student_id and st.active and c.id=i.student_card_id and c.active for share of st,c;
  if not found then raise exception 'NOT_FOUND'; end if;
  select least(i.total_won,greatest(0::bigint,w.balance_won-settings.negative_wallet_limit_won)) into capacity
   from private.wallets w cross join private.system_settings settings where w.student_id=i.student_id and settings.singleton for share of w;
  if p_wallet_amount_won is null or p_wallet_amount_won<=0 or p_wallet_amount_won>i.total_won then raise exception 'TENDER_INVALID'; end if;
  if capacity is null or p_wallet_amount_won>capacity then raise exception 'WALLET_LIMIT'; end if;
  update private.payment_intents set wallet_amount_won=p_wallet_amount_won,
   tender_mode=case when p_wallet_amount_won=i.total_won then 'WALLET' else 'SPLIT' end,updated_at=now() where id=i.id returning * into i;
 end if;
 return query select i.id,i.state,i.subtotal_won,i.discount_won,i.total_won,i.coupon_name_snapshot,i.coupon_code_masked,
  i.expires_at,i.tender_mode,i.wallet_amount_won,i.total_won-i.wallet_amount_won;
end;
$$;

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

create or replace function private.post_sale_tenders() returns trigger
language plpgsql security definer set search_path = '' as $$
declare i private.payment_intents; t private.terminals;
begin
  if new.channel='ONLINE_STORE' then
    insert into private.sale_tenders(sale_id,tender_type,settled_amount_won,student_id)
      values(new.id,'WALLET',new.total_won,new.student_id);
  else
    select * into i from private.payment_intents where id=new.payment_intent_id;
    if not found then raise exception 'TENDER_INVALID'; end if;
    select tt.* into t from private.terminals tt join private.staff_sessions ss on ss.terminal_id=tt.id where ss.id=new.staff_session_id;
    if i.tender_mode <> 'CASH' then
      insert into private.sale_tenders(sale_id,tender_type,settled_amount_won,student_id,terminal_id)
        values(new.id,'WALLET',i.wallet_amount_won,new.student_id,t.id);
    end if;
    if i.tender_mode <> 'WALLET' then
      if not t.cash_enabled or t.cash_ends_at is null or t.cash_ends_at<=clock_timestamp() then raise exception 'CASH_DISABLED'; end if;
      insert into private.sale_tenders(sale_id,tender_type,settled_amount_won,terminal_id,event_name_snapshot,cash_received_won,change_given_won)
        values(new.id,'CASH',new.total_won-i.wallet_amount_won,t.id,t.cash_event_name,i.cash_received_won,i.cash_received_won-(new.total_won-i.wallet_amount_won));
    end if;
  end if;
  return new;
end;
$$;

revoke all on function api.terminal_payment_policy_v2(uuid),api.set_terminal_payment_policy(uuid,boolean,text,timestamptz),api.scan_payment_card(uuid,uuid,text),api.finalize_payment_tender(uuid,uuid,bigint) from public;
grant execute on function api.terminal_payment_policy_v2(uuid),api.set_terminal_payment_policy(uuid,boolean,text,timestamptz),api.scan_payment_card(uuid,uuid,text),api.finalize_payment_tender(uuid,uuid,bigint) to campuspay_runtime;
insert into private.schema_migrations(version) values('20260908090000_register_remediation') on conflict do nothing;
