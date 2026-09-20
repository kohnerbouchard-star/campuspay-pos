-- Forward-only audit hardening. No data changes, activation or credential issuance.
-- Preserve published migration 028; apply this after it on fresh and upgraded databases.
create or replace function api.change_administration(p_session_id uuid,p_key uuid,p_action text,p_target_id uuid,p_payload jsonb,p_admin_pin_proof text,p_notes text)
returns table(result jsonb) language plpgsql security definer set search_path = '' as $$
declare s private.staff_sessions; actor public.staff_profiles; target public.staff_profiles;
 t private.terminals; old private.administration_operations; proof text; response jsonb; changed uuid; n integer:=0; role_value public.staff_role; active_value boolean;
begin
 -- Login and lifecycle writers share this lock, so no new target sessions
 -- can appear between the drain and revocation. Do not touch a terminal or
 -- profile while waiting for an in-flight operation's session row.
 perform pg_advisory_xact_lock(hashtextextended('campuspay-staff-administration',0));
 -- Non-locking preliminary authorization prevents an invalid caller from
 -- locking arbitrary targets. Revalidate under the acquired locks below.
 select * into s from private.staff_sessions where id=p_session_id;
 if s.id is null or s.revoked_at is not null or s.expires_at<=clock_timestamp()
  or s.created_at+interval '8 hours'<=clock_timestamp() then raise exception 'SESSION_EXPIRED'; end if;
 if s.role_snapshot<>'super_admin'
  or not exists(select 1 from public.staff_profiles where auth_user_id=s.auth_user_id and active and role='super_admin')
  or not exists(select 1 from private.terminals where id=s.terminal_id and active) then raise exception 'FORBIDDEN'; end if;
 if p_key is null or p_action is null or p_action not in ('CREATE_STAFF','UPDATE_STAFF','RESET_STAFF_PIN','REVOKE_STAFF_SESSIONS','UPDATE_TERMINAL','REVOKE_TERMINAL_SESSIONS')
  or jsonb_typeof(p_payload) is distinct from 'object' or p_notes is null or length(btrim(p_notes)) not between 10 and 500 or p_notes ~ '[[:cntrl:]]'
  or (p_action='CREATE_STAFF' and p_target_id is not null) or (p_action<>'CREATE_STAFF' and p_target_id is null) then raise exception 'BAD_REQUEST'; end if;
 -- Acquire the complete affected session set in a stable order BEFORE
 -- assert_session updates the actor's terminal. Also covers same-terminal
 -- operations, PIN resets, session-only revocation and terminal changes.
 perform 1 from private.staff_sessions ss
 where ss.id=p_session_id or (ss.revoked_at is null and (
  (p_action in ('UPDATE_STAFF','RESET_STAFF_PIN','REVOKE_STAFF_SESSIONS') and ss.auth_user_id=p_target_id)
  or (p_action in ('UPDATE_TERMINAL','REVOKE_TERMINAL_SESSIONS') and ss.terminal_id=p_target_id)))
 order by ss.id for update;
 s:=private.assert_session(p_session_id,'security.staff.manage');
 proof:=encode(extensions.digest(jsonb_build_array(p_action,p_target_id,p_payload,btrim(p_notes))::text,'sha256'),'hex');
 select * into old from private.administration_operations where request_key=p_key;
 if found then
  if old.actor_id<>s.auth_user_id or old.terminal_id<>s.terminal_id then raise exception 'CONFLICT'; end if;
  if old.action<>'CLOSED' and old.request_proof<>proof then raise exception 'CONFLICT'; end if;
  return query select old.result; return;
 end if;
 if not (select administration_enabled from private.system_settings where singleton) then raise exception 'ADMINISTRATION_DISABLED'; end if;
 actor:=private.verify_staff_pin(s.employee_code_snapshot,p_admin_pin_proof,'super_admin');
 -- Return, rather than raise, so the existing credential lockout counter commits.
 if actor.auth_user_id is null then return query select jsonb_build_object('outcome','AUTH_FAILED'); return; end if;
 if p_action in ('CREATE_STAFF','UPDATE_STAFF') then
  if p_payload->>'display_name' is null or length(btrim(p_payload->>'display_name')) not between 1 and 120 or p_payload->>'display_name' ~ '[[:cntrl:]]'
   or p_payload->>'role' is null or p_payload->>'role' not in ('cashier','inventory_admin','accountant','super_admin') then raise exception 'BAD_REQUEST'; end if;
  role_value:=(p_payload->>'role')::public.staff_role;
 end if;
 if p_action in ('CREATE_STAFF','RESET_STAFF_PIN') and (p_payload->>'pin_proof' is null or p_payload->>'pin_proof' !~ '^[a-f0-9]{64}$') then raise exception 'BAD_REQUEST'; end if;
 if p_action='CREATE_STAFF' then
  if p_payload->>'employee_code' is null or p_payload->>'employee_code' !~ '^[A-Za-z0-9_-]{2,32}$' then raise exception 'BAD_REQUEST'; end if;
  if exists(select 1 from public.staff_profiles where lower(employee_code)=lower(p_payload->>'employee_code')) then raise exception 'CONFLICT'; end if;
  insert into public.staff_profiles(employee_code,display_name,role) values(p_payload->>'employee_code',btrim(p_payload->>'display_name'),role_value) returning auth_user_id into changed;
  insert into private.staff_credentials(staff_user_id,pin_hash) values(changed,extensions.crypt(p_payload->>'pin_proof',extensions.gen_salt('bf',12)));
 elsif p_action in ('UPDATE_STAFF','RESET_STAFF_PIN','REVOKE_STAFF_SESSIONS') then
  if p_target_id=s.auth_user_id then raise exception 'SELF_CHANGE_FORBIDDEN'; end if;
  select * into target from public.staff_profiles where auth_user_id=p_target_id for no key update;
  if not found then raise exception 'NOT_FOUND'; end if;
  -- Target sessions are already drained; immutable profile IDs only need
  -- NO KEY UPDATE, which permits unrelated journal foreign-key references.
  changed:=target.auth_user_id;
  if p_action='UPDATE_STAFF' then
   if jsonb_typeof(p_payload->'active') is distinct from 'boolean' or p_payload->>'expected_updated_at' is null then raise exception 'BAD_REQUEST'; end if;
   if target.updated_at is distinct from (p_payload->>'expected_updated_at')::timestamptz then raise exception 'CONFLICT'; end if;
   active_value:=(p_payload->>'active')::boolean;
   if target.active and target.role='super_admin' and (not active_value or role_value<>'super_admin') and
    not exists(select 1 from public.staff_profiles where active and role='super_admin' and auth_user_id<>target.auth_user_id) then raise exception 'LAST_ADMIN_REQUIRED'; end if;
   if (not active_value or role_value<>target.role) and exists(select 1 from private.cash_shifts where opened_by=target.auth_user_id and closed_at is null) then raise exception 'OPEN_CASH_SHIFT'; end if;
   update public.staff_profiles set display_name=btrim(p_payload->>'display_name'),role=role_value,active=active_value,updated_at=clock_timestamp() where auth_user_id=target.auth_user_id;
  elsif p_action='RESET_STAFF_PIN' then
   insert into private.staff_credentials(staff_user_id,pin_hash) values(target.auth_user_id,extensions.crypt(p_payload->>'pin_proof',extensions.gen_salt('bf',12)))
   on conflict(staff_user_id) do update set pin_hash=excluded.pin_hash,failed_attempts=0,locked_until=null,pin_updated_at=clock_timestamp();
  end if;
  update private.staff_sessions set revoked_at=clock_timestamp() where auth_user_id=target.auth_user_id and revoked_at is null;
  get diagnostics n=row_count;
 else
  if p_target_id=s.terminal_id and (p_action='REVOKE_TERMINAL_SESSIONS' or (p_payload->>'active')::boolean is distinct from true) then raise exception 'SELF_CHANGE_FORBIDDEN'; end if;
  select * into t from private.terminals where id=p_target_id for no key update;
  if not found then raise exception 'NOT_FOUND'; end if;
  changed:=t.id;
  if p_action='UPDATE_TERMINAL' then
   if p_payload->>'label' is null or length(btrim(p_payload->>'label')) not between 1 and 120 or p_payload->>'label' ~ '[[:cntrl:]]'
    or jsonb_typeof(p_payload->'active') is distinct from 'boolean' then raise exception 'BAD_REQUEST'; end if;
   if jsonb_typeof(p_payload->'expected_active') is distinct from 'boolean' or not (p_payload ? 'expected_label') then raise exception 'BAD_REQUEST'; end if;
   if t.active is distinct from (p_payload->>'expected_active')::boolean or t.label is distinct from p_payload->>'expected_label' then raise exception 'CONFLICT'; end if;
   active_value:=(p_payload->>'active')::boolean;
   if not active_value and exists(select 1 from private.cash_shifts where terminal_id=t.id and closed_at is null) then raise exception 'OPEN_CASH_SHIFT'; end if;
   update private.terminals set label=btrim(p_payload->>'label'),active=active_value where id=t.id;
  end if;
  update private.staff_sessions set revoked_at=clock_timestamp() where terminal_id=t.id and terminal_id<>s.terminal_id and revoked_at is null;
  get diagnostics n=row_count;
 end if;
 response:=jsonb_build_object('outcome','COMPLETED','target_id',changed,'sessions_revoked',n,'audit_reference','AUD-ADMIN-'||p_key);
 insert into private.administration_operations(request_key,actor_id,terminal_id,action,request_proof,result)
 values(p_key,s.auth_user_id,s.terminal_id,p_action,proof,response);
 insert into private.audit_events(event_type,actor_user_id,staff_session_id,subject_type,subject_id,reference_number,safe_payload)
 values('ADMINISTRATION_CHANGED',s.auth_user_id,s.id,case when p_action like '%TERMINAL%' then 'TERMINAL' else 'STAFF' end,changed,'AUD-ADMIN-'||p_key,
  jsonb_build_object('action',p_action,'notes',btrim(p_notes),'sessions_revoked',n));
 return query select response;
end $$;

-- Keep login's existing verification, rate limiting and response contract.
-- Drain the existing terminal's sessions before credentials/terminal updates,
-- not after the terminal upsert. This uses the same lifecycle/session order.
do $$
declare definition text;
 anchor text := 'perform pg_advisory_xact_lock(hashtextextended(''campuspay-staff-administration'',0));';
 replacement text;
begin
 definition:=pg_get_functiondef('api.create_staff_session(text,text,text,text)'::regprocedure);
 if (length(definition)-length(replace(definition,anchor,'')))/length(anchor)<>1 then
  raise exception 'STAFF_LOGIN_LOCK_PATCH_PRECONDITION';
 end if;
 replacement:=anchor||E'\n  perform 1 from private.staff_sessions ss where ss.terminal_id=(select id from private.terminals where terminal_fingerprint=p_terminal_fingerprint) and ss.revoked_at is null order by ss.id for update;';
 execute replace(definition,anchor,replacement);
end $$;
revoke all on function api.change_administration(uuid,uuid,text,uuid,jsonb,text,text) from public;
grant execute on function api.change_administration(uuid,uuid,text,uuid,jsonb,text,text) to campuspay_runtime;
insert into private.schema_migrations(version) values('20260920100000_administration_lock_order') on conflict do nothing;
