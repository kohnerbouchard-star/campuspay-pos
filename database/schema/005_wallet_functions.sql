create or replace function api.search_student_wallets(p_session_id uuid, p_query text default '')
returns table(
  student_id uuid,
  student_code text,
  display_name text,
  balance_won bigint,
  debt_won bigint,
  card_active boolean
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.assert_session(p_session_id, 'wallet.read');
  return query
  select s.id, s.student_code, s.display_name, w.balance_won,
    greatest(0::bigint, -w.balance_won),
    exists(select 1 from private.student_cards c where c.student_id = s.id and c.active)
  from private.students s
  join private.wallets w on w.student_id = s.id
  where s.active and (
    trim(coalesce(p_query,'')) = ''
    or s.student_code ilike '%' || trim(p_query) || '%'
    or s.display_name ilike '%' || trim(p_query) || '%'
  )
  order by case when w.balance_won < 0 then 0 else 1 end, s.display_name
  limit 100;
end;
$$;

create or replace function api.create_wallet_adjustment_intent(
  p_session_id uuid,
  p_direction text,
  p_denominations integer[],
  p_reason_code text,
  p_notes text,
  p_idempotency_key uuid
)
returns table(
  intent_id uuid,
  direction private.wallet_direction,
  amount_won bigint,
  state private.intent_state,
  expires_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session private.staff_sessions;
  v_existing private.wallet_adjustment_intents;
  v_intent private.wallet_adjustment_intents;
  v_denom integer;
  v_amount bigint := 0;
begin
  v_session := private.assert_session(p_session_id, 'wallet.adjust');
  if p_direction not in ('CREDIT','DEBIT')
     or coalesce(array_length(p_denominations,1),0) < 1
     or array_length(p_denominations,1) > 30
     or length(trim(p_notes)) < 3 then raise exception 'BAD_REQUEST'; end if;

  foreach v_denom in array p_denominations loop
    if v_denom <> all(array[1000,5000,10000,20000,50000]) then raise exception 'BAD_REQUEST'; end if;
    v_amount := v_amount + v_denom;
  end loop;
  if v_amount <= 0 then raise exception 'BAD_REQUEST'; end if;

  if p_direction = 'CREDIT' and p_reason_code <> 'FUNDS_RECEIVED' then raise exception 'BAD_REQUEST'; end if;
  if p_direction = 'DEBIT' and p_reason_code not in (
    'PURCHASE_CORRECTION','DUPLICATE_CREDIT_REVERSAL','ADMINISTRATIVE_CHARGE','OTHER_APPROVED_CORRECTION'
  ) then raise exception 'BAD_REQUEST'; end if;

  select * into v_existing from private.wallet_adjustment_intents where idempotency_key = p_idempotency_key;
  if found then
    if v_existing.staff_session_id <> v_session.id then raise exception 'CONFLICT'; end if;
    return query select v_existing.id, v_existing.direction, v_existing.amount_won, v_existing.state, v_existing.expires_at;
    return;
  end if;

  insert into private.wallet_adjustment_intents(
    idempotency_key, staff_session_id, direction, amount_won, denominations,
    reason_code, notes, state, expires_at
  ) values (
    p_idempotency_key, v_session.id, p_direction::private.wallet_direction, v_amount, p_denominations,
    p_reason_code, trim(p_notes), 'awaiting_card', now() + interval '60 seconds'
  ) returning * into v_intent;

  return query select v_intent.id, v_intent.direction, v_intent.amount_won, v_intent.state, v_intent.expires_at;
end;
$$;

create or replace function api.scan_wallet_adjustment_card(
  p_session_id uuid,
  p_intent_id uuid,
  p_card_fingerprint text
)
returns table(
  intent_id uuid,
  state private.intent_state,
  student_id uuid,
  student_display_name text,
  current_balance_won bigint,
  projected_balance_won bigint,
  projected_debt_won bigint
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session private.staff_sessions;
  v_intent private.wallet_adjustment_intents;
  v_student private.students;
  v_balance bigint;
  v_projected bigint;
begin
  v_session := private.assert_session(p_session_id, 'wallet.adjust');
  select * into v_intent from private.wallet_adjustment_intents where id = p_intent_id for update;
  if not found or v_intent.staff_session_id <> v_session.id then raise exception 'NOT_FOUND'; end if;
  if v_intent.expires_at <= now() then
    update private.wallet_adjustment_intents set state = 'expired', updated_at = now() where id = v_intent.id;
    raise exception 'SESSION_EXPIRED';
  end if;
  if v_intent.state <> 'awaiting_card' then raise exception 'CONFLICT'; end if;

  select s.* into v_student
  from private.student_cards c
  join private.students s on s.id = c.student_id
  where c.card_fingerprint = p_card_fingerprint and c.active and s.active;
  if not found then raise exception 'NOT_FOUND'; end if;
  select w.balance_won into v_balance from private.wallets w where w.student_id = v_student.id;
  if not found then raise exception 'NOT_FOUND'; end if;

  v_projected := case when v_intent.direction = 'CREDIT'
    then v_balance + v_intent.amount_won else v_balance - v_intent.amount_won end;
  update private.wallet_adjustment_intents
  set student_id = v_student.id, state = 'awaiting_pin', updated_at = now()
  where id = v_intent.id;

  return query select v_intent.id, 'awaiting_pin'::private.intent_state,
    v_student.id, v_student.display_name, v_balance, v_projected, greatest(0::bigint, -v_projected);
end;
$$;

create or replace function api.confirm_wallet_adjustment(
  p_session_id uuid,
  p_intent_id uuid,
  p_student_pin_proof text
)
returns table(
  approved boolean,
  error_code text,
  ledger_id uuid,
  reference_number text,
  amount_won bigint,
  balance_before_won bigint,
  balance_after_won bigint,
  debt_after_won bigint,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session private.staff_sessions;
  v_intent private.wallet_adjustment_intents;
  v_credential private.student_credentials;
  v_wallet private.wallets;
  v_settings private.system_settings;
  v_projected bigint;
  v_signed_amount bigint;
  v_ledger private.wallet_ledger;
  v_reference text;
  v_now timestamptz := now();
begin
  v_session := private.assert_session(p_session_id, 'wallet.adjust');
  select * into v_intent from private.wallet_adjustment_intents where id = p_intent_id for update;
  if not found or v_intent.staff_session_id <> v_session.id then raise exception 'NOT_FOUND'; end if;
  if v_intent.expires_at <= v_now then
    update private.wallet_adjustment_intents set state = 'expired', updated_at = v_now where id = v_intent.id;
    return query select false, 'SESSION_EXPIRED', null::uuid, null::text, null::bigint,
      null::bigint, null::bigint, null::bigint, v_now;
    return;
  end if;
  if v_intent.state = 'completed' and v_intent.completed_ledger_id is not null then
    return query select true, null::text, wl.id, wl.reference_number, wl.amount_won,
      wl.balance_before_won, wl.balance_after_won, greatest(0::bigint, -wl.balance_after_won), wl.created_at
    from private.wallet_ledger wl where wl.id = v_intent.completed_ledger_id;
    return;
  end if;
  if v_intent.state <> 'awaiting_pin' or v_intent.student_id is null then raise exception 'CONFLICT'; end if;

  select * into v_credential from private.student_credentials where student_id = v_intent.student_id for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if v_credential.locked_until is not null and v_credential.locked_until > v_now then
    return query select false, 'RATE_LIMITED', null::uuid, null::text, null::bigint,
      null::bigint, null::bigint, null::bigint, v_now;
    return;
  end if;
  if extensions.crypt(p_student_pin_proof, v_credential.pin_hash) <> v_credential.pin_hash then
    update private.student_credentials
    set failed_attempts = failed_attempts + 1,
        locked_until = case when failed_attempts + 1 >= 3 then v_now + interval '5 minutes' else null end
    where student_id = v_intent.student_id;
    update private.wallet_adjustment_intents
    set pin_attempts = least(3, pin_attempts + 1),
        state = case when pin_attempts + 1 >= 3 then 'cancelled'::private.intent_state else state end,
        updated_at = v_now
    where id = v_intent.id;
    return query select false, 'INVALID_PIN', null::uuid, null::text, null::bigint,
      null::bigint, null::bigint, null::bigint, v_now;
    return;
  end if;
  update private.student_credentials set failed_attempts = 0, locked_until = null where student_id = v_intent.student_id;

  select * into v_wallet from private.wallets where student_id = v_intent.student_id for update;
  select * into v_settings from private.system_settings where singleton;
  v_signed_amount := case when v_intent.direction = 'CREDIT' then v_intent.amount_won else -v_intent.amount_won end;
  v_projected := v_wallet.balance_won + v_signed_amount;
  if v_projected < v_settings.negative_wallet_limit_won then
    update private.wallet_adjustment_intents set state = 'cancelled', updated_at = v_now where id = v_intent.id;
    return query select false, 'WALLET_LIMIT', null::uuid, null::text, v_signed_amount,
      v_wallet.balance_won, v_projected, greatest(0::bigint, -v_projected), v_now;
    return;
  end if;

  v_reference := 'WAL-' || to_char(v_now, 'YYYYMMDD') || '-' || lpad(nextval('private.adjustment_sequence')::text, 6, '0');
  insert into private.wallet_ledger(
    reference_number, student_id, amount_won, entry_type, reason_code,
    balance_before_won, balance_after_won, staff_user_id, staff_session_id,
    source_type, source_id, idempotency_key, notes
  ) values (
    v_reference, v_intent.student_id, v_signed_amount,
    case when v_signed_amount > 0 then 'FUNDS_ADDED' else 'CONTROLLED_DEDUCTION' end,
    v_intent.reason_code, v_wallet.balance_won, v_projected,
    v_session.auth_user_id, v_session.id, 'WALLET_ADJUSTMENT', v_intent.id, v_intent.idempotency_key, v_intent.notes
  ) returning * into v_ledger;

  update private.wallets set balance_won = v_projected, updated_at = v_now where student_id = v_intent.student_id;
  update private.wallet_adjustment_intents set state = 'completed', completed_ledger_id = v_ledger.id, updated_at = v_now where id = v_intent.id;

  insert into private.audit_events(event_type, actor_user_id, staff_session_id, subject_type, subject_id, reference_number, safe_payload)
  values ('WALLET_ADJUSTMENT_POSTED', v_session.auth_user_id, v_session.id, 'WALLET_LEDGER', v_ledger.id,
    'AUD-' || v_reference, jsonb_build_object('amount_won', v_signed_amount, 'reason_code', v_intent.reason_code));

  return query select true, null::text, v_ledger.id, v_reference, v_signed_amount,
    v_wallet.balance_won, v_projected, greatest(0::bigint, -v_projected), v_now;
end;
$$;
