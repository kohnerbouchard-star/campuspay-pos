create or replace function private.permissions_for_role(p_role public.staff_role)
returns text[]
language sql
immutable
set search_path = ''
as $$
  select case p_role
    when 'cashier' then array['pos.read','pos.checkout','coupons.redeem']::text[]
    when 'inventory_admin' then array[
      'inventory.read','inventory.receive','inventory.adjust','inventory.product.manage','inventory.price.manage',
      'coupons.manage','reports.inventory','security.credentials.request'
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
      'security.credentials.request','security.step_up','security.credentials.reset','security.staff.manage'
    ]::text[]
  end;
$$;

create or replace function private.role_has_permission(p_role public.staff_role, p_permission text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_permission = any(private.permissions_for_role(p_role));
$$;

create or replace function private.session_timeout(p_role public.staff_role)
returns interval
language sql
immutable
set search_path = ''
as $$
  select case when p_role = 'cashier' then interval '20 seconds' else interval '2 minutes' end;
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
  v_now timestamptz := now();
begin
  if p_employee_code is null or p_employee_code !~ '^[A-Za-z0-9_-]{2,32}$'
     or p_pin_proof is null or p_pin_proof !~ '^[a-f0-9]{64}$' then
    raise exception 'UNAUTHENTICATED';
  end if;

  select sp.* into v_profile
  from public.staff_profiles sp
  where lower(sp.employee_code) = lower(p_employee_code) and sp.active;
  if not found then raise exception 'UNAUTHENTICATED'; end if;

  select * into v_credential
  from private.staff_credentials
  where staff_user_id = v_profile.auth_user_id
  for update;
  if not found then raise exception 'UNAUTHENTICATED'; end if;
  if v_credential.locked_until is not null and v_credential.locked_until > v_now then
    raise exception 'RATE_LIMITED';
  end if;

  if extensions.crypt(p_pin_proof, v_credential.pin_hash) <> v_credential.pin_hash then
    update private.staff_credentials
    set failed_attempts = failed_attempts + 1,
        locked_until = case when failed_attempts + 1 >= 5 then v_now + interval '5 minutes' else null end
    where staff_user_id = v_profile.auth_user_id;
    raise exception 'UNAUTHENTICATED';
  end if;

  if p_required_role is not null and v_profile.role <> p_required_role then
    raise exception 'UNAUTHENTICATED';
  end if;

  update private.staff_credentials
  set failed_attempts = 0, locked_until = null
  where staff_user_id = v_profile.auth_user_id;
  return v_profile;
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
begin
  select * into v_session
  from private.staff_sessions
  where id = p_session_id
  for update;

  if not found or v_session.revoked_at is not null or v_session.expires_at <= now() then
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
  set last_activity_at = now(), expires_at = now() + private.session_timeout(v_profile.role)
  where id = v_session.id
  returning * into v_session;

  update private.terminals set last_seen_at = now() where id = v_session.terminal_id;
  return v_session;
end;
$$;

create or replace function private.assert_session_any(p_session_id uuid, p_permissions text[])
returns private.staff_sessions
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session private.staff_sessions;
  v_role public.staff_role;
  v_permission text;
begin
  select role_snapshot into v_role from private.staff_sessions where id = p_session_id;
  if not found then raise exception 'SESSION_EXPIRED'; end if;
  foreach v_permission in array p_permissions loop
    if private.role_has_permission(v_role, v_permission) then
      return private.assert_session(p_session_id, v_permission);
    end if;
  end loop;
  raise exception 'FORBIDDEN';
end;
$$;

create or replace function api.create_staff_session(
  p_employee_code text,
  p_pin_proof text,
  p_session_token_hash text,
  p_terminal_fingerprint text
)
returns table(
  session_id uuid,
  user_id uuid,
  employee_code text,
  display_name text,
  role public.staff_role,
  permissions text[],
  expires_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile public.staff_profiles;
  v_terminal private.terminals;
  v_session private.staff_sessions;
begin
  if p_session_token_hash !~ '^[a-f0-9]{64}$' or p_terminal_fingerprint !~ '^[a-f0-9]{64}$' then
    raise exception 'BAD_REQUEST';
  end if;

  v_profile := private.verify_staff_pin(p_employee_code, p_pin_proof, null);

  insert into private.terminals(terminal_fingerprint)
  values (p_terminal_fingerprint)
  on conflict (terminal_fingerprint) do update set last_seen_at = now()
  returning * into v_terminal;
  if not v_terminal.active then raise exception 'FORBIDDEN'; end if;

  update private.staff_sessions set revoked_at = now()
  where terminal_id = v_terminal.id and revoked_at is null;

  insert into private.staff_sessions(
    auth_user_id, employee_code_snapshot, role_snapshot, terminal_id,
    session_token_hash, expires_at
  ) values (
    v_profile.auth_user_id, v_profile.employee_code, v_profile.role, v_terminal.id,
    p_session_token_hash, now() + private.session_timeout(v_profile.role)
  ) returning * into v_session;

  return query select
    v_session.id, v_profile.auth_user_id, v_profile.employee_code, v_profile.display_name,
    v_profile.role, private.permissions_for_role(v_profile.role), v_session.expires_at;
end;
$$;

create or replace function api.authorize_session(
  p_session_token_hash text,
  p_terminal_fingerprint text,
  p_permission text default null
)
returns table(
  session_id uuid,
  user_id uuid,
  employee_code text,
  display_name text,
  role public.staff_role,
  permissions text[],
  expires_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session private.staff_sessions;
  v_profile public.staff_profiles;
begin
  select ss.* into v_session
  from private.staff_sessions ss
  join private.terminals t on t.id = ss.terminal_id
  where ss.session_token_hash = p_session_token_hash
    and t.terminal_fingerprint = p_terminal_fingerprint
    and t.active
  for update of ss;

  if not found then raise exception 'SESSION_EXPIRED'; end if;
  v_session := private.assert_session(v_session.id, p_permission);

  select * into v_profile from public.staff_profiles
  where auth_user_id = v_session.auth_user_id and active;
  if not found then raise exception 'FORBIDDEN'; end if;

  return query select
    v_session.id, v_profile.auth_user_id, v_profile.employee_code, v_profile.display_name,
    v_profile.role, private.permissions_for_role(v_profile.role), v_session.expires_at;
end;
$$;

create or replace function api.revoke_staff_session(
  p_session_token_hash text,
  p_terminal_fingerprint text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update private.staff_sessions ss
  set revoked_at = now()
  from private.terminals t
  where ss.terminal_id = t.id
    and ss.session_token_hash = p_session_token_hash
    and t.terminal_fingerprint = p_terminal_fingerprint
    and ss.revoked_at is null;
end;
$$;
