-- One verification primitive for known and unknown credentials. This dummy
-- is a public, precomputed bcrypt-12 hash; it is never a usable credential.
create or replace function private.dummy_pin_hash() returns text
language sql immutable set search_path = '' as $$
  select '$2a$12$FLpC2amtyreBkJvhmkmcdu6FHzDaoz1krmJfhpeO7pXRQkaQH2VQa'::text;
$$;

create or replace function private.verify_pin_proof(p_proof text, p_hash text)
returns boolean language plpgsql set search_path = '' as $$
declare v_computed text;
begin
  v_computed := extensions.crypt(p_proof, coalesce(p_hash, private.dummy_pin_hash()));
  return p_hash is not null and v_computed is not distinct from p_hash;
end;
$$;

-- All staff RPCs use a 15-minute sliding server window, bounded by created_at.
-- POS also has its separate five-minute workstation lock.
create or replace function private.session_timeout(p_role public.staff_role)
returns interval language sql immutable set search_path = '' as $$
  select interval '15 minutes';
$$;


create or replace function private.verify_staff_pin(
  p_employee_code text,
  p_pin_proof text,
  p_required_role public.staff_role default null
)
returns public.staff_profiles
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile public.staff_profiles;
  v_credential private.staff_credentials;
  v_now timestamptz := clock_timestamp();
  v_verified boolean;
begin
  if p_employee_code is null or p_employee_code !~ '^[A-Za-z0-9_-]{2,32}$'
     or p_pin_proof is null or p_pin_proof !~ '^[a-f0-9]{64}$' then
    return null;
  end if;

  select sp.* into v_profile
  from public.staff_profiles sp
  where lower(sp.employee_code) = lower(p_employee_code) and sp.active;

  select * into v_credential
  from private.staff_credentials
  where staff_user_id = v_profile.auth_user_id
  for update;
  v_verified := private.verify_pin_proof(p_pin_proof, v_credential.pin_hash);
  if v_profile.auth_user_id is null or v_credential.staff_user_id is null then return null; end if;
  if v_credential.locked_until is not null and v_credential.locked_until > v_now then
    return null;
  end if;

  if not v_verified then
    update private.staff_credentials
    set failed_attempts = failed_attempts + 1,
        locked_until = case when failed_attempts + 1 >= 5 then v_now + interval '5 minutes' else null end
    where staff_user_id = v_profile.auth_user_id;
    return null;
  end if;

  if p_required_role is not null and v_profile.role <> p_required_role then
    return null;
  end if;

  update private.staff_credentials
  set failed_attempts = 0, locked_until = null
  where staff_user_id = v_profile.auth_user_id;
  return v_profile;
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
  v_now timestamptz := clock_timestamp();
  v_verified boolean;
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

  select * into v_credential
  from private.student_credentials sc
  where sc.student_id = v_student.id
  for update;
  v_verified := private.verify_pin_proof(p_pin_proof, v_credential.pin_hash);
  if v_credential.locked_until is not null and v_credential.locked_until > v_now then return; end if;

  if not v_verified then
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

create or replace function private.assert_session(p_session_id uuid, p_permission text)
returns private.staff_sessions
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session private.staff_sessions;
  v_profile public.staff_profiles;
  v_terminal private.terminals;
  v_now timestamptz;
begin
  select * into v_session
  from private.staff_sessions
  where id = p_session_id
  for update;

  v_now := clock_timestamp();
  if v_session.id is null or v_session.revoked_at is not null or v_session.expires_at <= v_now
     or v_session.created_at + interval '8 hours' <= v_now then
    raise exception 'SESSION_EXPIRED';
  end if;

  select * into v_terminal from private.terminals where id = v_session.terminal_id;
  if not found or not v_terminal.active then raise exception 'FORBIDDEN'; end if;

  select * into v_profile
  from public.staff_profiles
  where auth_user_id = v_session.auth_user_id;

  if not found or not v_profile.active or v_profile.role <> v_session.role_snapshot then
    raise exception 'FORBIDDEN';
  end if;

  if p_permission is not null and not private.role_has_permission(v_profile.role, p_permission) then
    raise exception 'FORBIDDEN';
  end if;

  update private.staff_sessions
  set last_activity_at = v_now, expires_at = least(v_now + private.session_timeout(v_profile.role), v_session.created_at + interval '8 hours')
  where id = v_session.id
  returning * into v_session;

  update private.terminals set last_seen_at = v_now where id = v_session.terminal_id;
  return v_session;
end;
$$;

revoke all on function private.dummy_pin_hash(), private.verify_pin_proof(text,text) from public, campuspay_runtime;
