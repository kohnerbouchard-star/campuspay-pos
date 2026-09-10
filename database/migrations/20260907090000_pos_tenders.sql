-- Terminal-scoped event cash and atomic POS split tender. No production execution.
alter table private.terminals add column cash_enabled boolean not null default false;
alter table private.terminals add column cash_event_name text check (cash_event_name is null or length(cash_event_name) between 2 and 80);
alter table private.terminals add constraint terminal_cash_event_required check (not cash_enabled or cash_event_name is not null);

alter table private.payment_intents add column tender_mode text not null default 'WALLET' check (tender_mode in ('WALLET','CASH','SPLIT'));
alter table private.payment_intents add column wallet_amount_won bigint;
update private.payment_intents set wallet_amount_won=total_won;
alter table private.payment_intents alter column wallet_amount_won set not null;
alter table private.payment_intents add column cash_received_won bigint;
alter table private.payment_intents add column student_card_id uuid references private.student_cards(id) on delete restrict;
alter table private.payment_intents add constraint payment_intent_tender_plan check (
  wallet_amount_won between 0 and total_won and
  ((tender_mode='WALLET' and wallet_amount_won=total_won and cash_received_won is null)
   or (tender_mode='CASH' and wallet_amount_won=0)
   or (tender_mode='SPLIT' and wallet_amount_won>0 and wallet_amount_won<total_won)) and
  (cash_received_won is null or cash_received_won between total_won-wallet_amount_won and 1000000000)
);
alter table private.sales alter column student_id drop not null;
alter table private.sales alter column balance_before_won drop not null;
alter table private.sales alter column balance_after_won drop not null;
alter table private.sales add constraint sales_wallet_identity check (
  (student_id is null and balance_before_won is null and balance_after_won is null and wallet_ledger_id is null and channel='POS')
  or (student_id is not null and balance_before_won is not null and balance_after_won is not null)
);
alter table private.coupon_redemptions alter column student_id drop not null;

create table private.sale_tenders (
  id uuid primary key default gen_random_uuid(),
  sale_id uuid not null references private.sales(id) on delete restrict,
  tender_type text not null check (tender_type in ('WALLET','CASH')),
  settled_amount_won bigint not null check (settled_amount_won>=0),
  student_id uuid references private.students(id) on delete restrict,
  terminal_id uuid references private.terminals(id) on delete restrict,
  event_name_snapshot text,
  cash_received_won bigint,
  change_given_won bigint,
  created_at timestamptz not null default now(),
  unique(sale_id,tender_type),
  constraint sale_tender_kind_fields check (
    (tender_type='WALLET' and student_id is not null and cash_received_won is null and change_given_won is null)
    or (tender_type='CASH' and student_id is null and terminal_id is not null and cash_received_won is not null
      and change_given_won is not null and cash_received_won>=settled_amount_won and change_given_won>=0
      and cash_received_won-settled_amount_won=change_given_won)
  )
);
create index sale_tenders_terminal_created_idx on private.sale_tenders(terminal_id,created_at) where tender_type='CASH';
insert into private.sale_tenders(sale_id,tender_type,settled_amount_won,student_id,terminal_id,created_at)
  select s.id,'WALLET',s.total_won,s.student_id,ss.terminal_id,s.created_at
  from private.sales s left join private.staff_sessions ss on ss.id=s.staff_session_id;
create trigger immutable_journal before update or delete on private.sale_tenders for each row execute function private.reject_journal_mutation();
revoke all on private.sale_tenders from public,campuspay_runtime;

-- Populate both channels' tender journals in the sale transaction; online orders are always wallet-only.
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
      if not t.cash_enabled then raise exception 'CASH_DISABLED'; end if;
      insert into private.sale_tenders(sale_id,tender_type,settled_amount_won,terminal_id,event_name_snapshot,cash_received_won,change_given_won)
        values(new.id,'CASH',new.total_won-i.wallet_amount_won,t.id,t.cash_event_name,i.cash_received_won,i.cash_received_won-(new.total_won-i.wallet_amount_won));
    end if;
  end if;
  return new;
end;
$$;
create trigger post_sale_tenders after insert on private.sales for each row execute function private.post_sale_tenders();

-- Deferred until all journal writes finish. A committed sale always reconciles to tenders and its wallet ledger.
create or replace function private.assert_sale_tender_totals() returns trigger
language plpgsql security definer set search_path = '' as $$
declare sid uuid; s private.sales; tender_total bigint; wallet_total bigint; tender_count integer; wallet_count integer;
begin
  if tg_table_name='sales' then
    sid := new.id;
  else
    sid := new.sale_id;
  end if;
  select * into s from private.sales where id=sid;
  select coalesce(sum(st.settled_amount_won),0),coalesce(sum(st.settled_amount_won) filter(where st.tender_type='WALLET'),0),count(*),count(*) filter(where st.tender_type='WALLET')
    into tender_total,wallet_total,tender_count,wallet_count from private.sale_tenders st where st.sale_id=sid;
  if tender_count=0 or tender_total<>s.total_won then raise exception 'TENDER_INVALID'; end if;
  if s.channel='ONLINE_STORE' and (tender_count<>1 or wallet_count<>1) then raise exception 'TENDER_INVALID'; end if;
  if wallet_count=0 then
    if s.student_id is not null or s.wallet_ledger_id is not null then raise exception 'TENDER_INVALID'; end if;
  else
    if s.student_id is null or s.balance_before_won-s.balance_after_won<>wallet_total
       or exists(select 1 from private.sale_tenders st where st.sale_id=sid and st.tender_type='WALLET' and st.student_id<>s.student_id) then raise exception 'TENDER_INVALID'; end if;
    if wallet_total>0 and not exists(select 1 from private.wallet_ledger wl where wl.id=s.wallet_ledger_id and wl.student_id=s.student_id and wl.amount_won=-wallet_total
      and wl.balance_before_won=s.balance_before_won and wl.balance_after_won=s.balance_after_won) then raise exception 'TENDER_INVALID'; end if;
    if wallet_total=0 and s.wallet_ledger_id is not null then raise exception 'TENDER_INVALID'; end if;
  end if;
  return null;
end;
$$;
create constraint trigger sale_tender_reconciliation after insert or update on private.sales deferrable initially deferred for each row execute function private.assert_sale_tender_totals();
create constraint trigger tender_sale_reconciliation after insert on private.sale_tenders deferrable initially deferred for each row execute function private.assert_sale_tender_totals();
revoke all on function private.post_sale_tenders(),private.assert_sale_tender_totals() from public,campuspay_runtime;

create or replace function api.terminal_payment_policy(p_session_id uuid)
returns table(terminal_label text,cash_enabled boolean,event_name text,can_manage boolean)
language plpgsql security definer set search_path = '' as $$
declare s private.staff_sessions;
begin
  s:=private.assert_session(p_session_id,'pos.read');
  return query select coalesce(t.label,'This register'),t.cash_enabled,t.cash_event_name,s.role_snapshot='super_admin'::public.staff_role
    from private.terminals t where t.id=s.terminal_id;
end;
$$;
create or replace function api.set_terminal_payment_policy(p_session_id uuid,p_cash_enabled boolean,p_event_name text)
returns table(terminal_label text,cash_enabled boolean,event_name text,can_manage boolean)
language plpgsql security definer set search_path = '' as $$
declare s private.staff_sessions; old_t private.terminals; event_label text;
begin
  s:=private.assert_session(p_session_id,'security.staff.manage');
  if s.role_snapshot<>'super_admin' then raise exception 'FORBIDDEN'; end if;
  event_label:=nullif(trim(p_event_name),'');
  if p_cash_enabled is null or (p_cash_enabled and (event_label is null or length(event_label) not between 2 and 80)) then raise exception 'BAD_REQUEST'; end if;
  select * into old_t from private.terminals where id=s.terminal_id for update;
  update private.terminals set cash_enabled=p_cash_enabled,cash_event_name=case when p_cash_enabled then event_label else null end where id=s.terminal_id;
  insert into private.audit_events(event_type,actor_user_id,staff_session_id,subject_type,subject_id,reference_number,safe_payload)
    values('TERMINAL_PAYMENT_POLICY_CHANGED',s.auth_user_id,s.id,'TERMINAL',s.terminal_id,'AUD-CASH-'||gen_random_uuid()::text,
      jsonb_build_object('scope','TERMINAL','old_cash_enabled',old_t.cash_enabled,'new_cash_enabled',p_cash_enabled,'old_event_name',old_t.cash_event_name,'new_event_name',case when p_cash_enabled then event_label else null end));
  return query select * from api.terminal_payment_policy(s.id);
end;
$$;

create or replace function api.cancel_payment_intent(p_session_id uuid,p_intent_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare s private.staff_sessions; i private.payment_intents;
begin
  s:=private.assert_session(p_session_id,'pos.checkout');
  select * into i from private.payment_intents where id=p_intent_id for update;
  if not found or i.staff_session_id<>s.id then raise exception 'NOT_FOUND'; end if;
  if i.state='completed' then raise exception 'CONFLICT'; end if;
  update private.payment_intents set state='cancelled',updated_at=now() where id=i.id;
end;
$$;
drop function api.create_payment_intent(uuid,jsonb,uuid,text);
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
  if p_tender_mode <> 'WALLET' and not v_terminal.cash_enabled then raise exception 'CASH_DISABLED'; end if;
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
  if v_wallet_amount is null or v_wallet_amount < 0 or v_wallet_amount > v_subtotal - v_discount
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
  if v_intent.tender_mode = 'CASH' or v_intent.state <> 'awaiting_card' then raise exception 'CONFLICT'; end if;

  select s.* into v_student
  from private.student_cards c
  join private.students s on s.id = c.student_id
  where c.card_fingerprint = p_card_fingerprint and c.active and s.active;
  if not found then raise exception 'NOT_FOUND'; end if;

  select balance_won into v_balance from private.wallets where student_id = v_student.id;
  if not found then raise exception 'NOT_FOUND'; end if;
  v_projected := v_balance - v_intent.wallet_amount_won;

  update private.payment_intents
  set student_card_id = (select c.id from private.student_cards c where c.card_fingerprint = p_card_fingerprint and c.active), student_id = v_student.id, state = 'awaiting_pin', card_scanned_at = now(), updated_at = now()
  where id = v_intent.id;

  return query select
    v_intent.id, 'awaiting_pin'::private.intent_state, v_student.display_name,
    v_balance, v_projected, greatest(0::bigint, -v_projected), v_intent.expires_at;
end;
$$;

drop function api.confirm_payment(uuid,uuid,text);
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

  select * into v_terminal from private.terminals where id = v_session.terminal_id for share;
  v_cash_due := v_intent.total_won - v_intent.wallet_amount_won;
  if v_intent.tender_mode <> 'WALLET' and not v_terminal.cash_enabled then raise exception 'CASH_DISABLED'; end if;
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
      'terminal_id', v_session.terminal_id, 'event_name', v_terminal.cash_event_name
    )
  );

  return query select true, null::text, v_sale.id, v_receipt,
    v_intent.subtotal_won, v_intent.discount_won, v_intent.total_won,
    v_intent.coupon_name_snapshot, v_intent.coupon_code_masked,
    v_wallet.balance_won, v_projected, greatest(0::bigint, -v_projected), v_all_cogs, v_now, v_intent.tender_mode, v_intent.wallet_amount_won, v_intent.total_won-v_intent.wallet_amount_won, v_intent.cash_received_won, v_intent.cash_received_won-(v_intent.total_won-v_intent.wallet_amount_won);
end;
$$;


-- Aggregate tenders before joining sales: each sale contributes revenue and COGS exactly once.
drop function api.report_sales(uuid,date,date);
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
 where (p_from is null or s.created_at>=(p_from::timestamp at time zone 'Asia/Seoul')) and (p_to is null or s.created_at<((p_to+1)::timestamp at time zone 'Asia/Seoul'))
 order by s.created_at desc;
end;
$$;
revoke all on function api.create_payment_intent(uuid,jsonb,uuid,text,text,bigint),api.confirm_payment(uuid,uuid,text,bigint),api.terminal_payment_policy(uuid),api.set_terminal_payment_policy(uuid,boolean,text),api.cancel_payment_intent(uuid,uuid),api.report_sales(uuid,date,date) from public;
grant execute on function api.create_payment_intent(uuid,jsonb,uuid,text,text,bigint),api.confirm_payment(uuid,uuid,text,bigint),api.terminal_payment_policy(uuid),api.set_terminal_payment_policy(uuid,boolean,text),api.cancel_payment_intent(uuid,uuid),api.report_sales(uuid,date,date) to campuspay_runtime;
insert into private.schema_migrations(version) values('20260907090000_pos_tenders') on conflict do nothing;

-- Recover an interrupted payment after reload or sign-in on the same physical register.
-- Locking the intent waits for any in-flight settlement. An uncommitted proposal is
-- cancelled before returning, so the cashier can never accidentally charge it later.
create or replace function api.recover_payment_intent(p_session_id uuid,p_intent_id uuid)
returns table(state text,receipt jsonb,items jsonb)
language plpgsql security definer set search_path = '' as $$
declare ss private.staff_sessions; i private.payment_intents; s private.sales; owner_terminal uuid;
begin
  ss:=private.assert_session(p_session_id,'pos.checkout');
  select * into i from private.payment_intents where id=p_intent_id for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  select terminal_id into owner_terminal from private.staff_sessions where id=i.staff_session_id;
  if owner_terminal<>ss.terminal_id then raise exception 'FORBIDDEN'; end if;
  if i.state='completed' and i.completed_sale_id is not null then
    select * into s from private.sales where id=i.completed_sale_id;
    return query select 'completed'::text,jsonb_build_object(
      'sale_id',s.id,'receipt_number',s.receipt_number,'subtotal_won',s.subtotal_won,'discount_won',s.discount_won,'total_won',s.total_won,
      'coupon_name',s.coupon_name_snapshot,'coupon_code_masked',s.coupon_code_masked,'balance_before_won',s.balance_before_won,'balance_after_won',s.balance_after_won,
      'debt_after_won',greatest(0::bigint,-s.balance_after_won),'cogs_won',s.cost_of_goods_sold_won,'created_at',s.created_at,
      'tender_mode',i.tender_mode,'wallet_tender_won',i.wallet_amount_won,'cash_tender_won',i.total_won-i.wallet_amount_won,
      'cash_received_won',i.cash_received_won,'change_given_won',i.cash_received_won-(i.total_won-i.wallet_amount_won)),
      (select coalesce(jsonb_agg(jsonb_build_object('name',si.product_name_snapshot,'quantity',si.quantity,'lineTotalWon',si.line_total_won) order by si.id),'[]'::jsonb) from private.sale_items si where si.sale_id=s.id);
  else
    update private.payment_intents set state='cancelled',updated_at=now() where id=i.id;
    return query select 'cancelled'::text,null::jsonb,'[]'::jsonb;
  end if;
end;
$$;
revoke all on function api.recover_payment_intent(uuid,uuid) from public;
grant execute on function api.recover_payment_intent(uuid,uuid) to campuspay_runtime;
