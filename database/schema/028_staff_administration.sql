-- Deliberate staff/terminal lifecycle changes only. No live activation, demo cleanup,
-- student enrollment, card issuance, wallet changes, or credential seeding.
alter table private.system_settings add column administration_enabled boolean not null default false;
create table private.administration_operations (
 request_key uuid primary key, actor_id uuid not null references public.staff_profiles(auth_user_id),
 terminal_id uuid not null references private.terminals(id), action text not null,
 request_proof text not null, result jsonb not null, created_at timestamptz not null default clock_timestamp()
);
create trigger immutable_journal before update or delete on private.administration_operations
 for each row execute function private.reject_journal_mutation();
revoke all on private.administration_operations from public,campuspay_runtime;

create function api.administration_snapshot(p_session_id uuid,p_staff_offset integer default 0,p_terminal_offset integer default 0)
returns table(result jsonb) language plpgsql security definer set search_path = '' as $$
declare s private.staff_sessions;
begin
 s:=private.assert_session(p_session_id,'security.staff.manage');
 if p_staff_offset is null or p_terminal_offset is null or p_staff_offset<0 or p_terminal_offset<0 then raise exception 'BAD_REQUEST'; end if;
 return query select jsonb_build_object(
 'enabled',(select administration_enabled from private.system_settings where singleton),'current_terminal_id',s.terminal_id,
 'staff_total',(select count(*) from public.staff_profiles),'terminal_total',(select count(*) from private.terminals),
 'staff',coalesce((select jsonb_agg(to_jsonb(x) order by x.employee_code,x.user_id) from (
  select sp.auth_user_id user_id,sp.employee_code,sp.display_name,sp.role,sp.active,sp.updated_at,
   exists(select 1 from private.staff_credentials c where c.staff_user_id=sp.auth_user_id) has_pin
  from public.staff_profiles sp order by sp.employee_code,sp.auth_user_id limit 50 offset p_staff_offset) x),'[]'::jsonb),
 'terminals',coalesce((select jsonb_agg(to_jsonb(x) order by x.last_seen_at desc,x.terminal_id) from (
  select t.id terminal_id,t.label,t.active,t.created_at,t.last_seen_at,
   exists(select 1 from private.cash_shifts c where c.terminal_id=t.id and c.closed_at is null) has_open_shift
  from private.terminals t order by t.last_seen_at desc,t.id limit 50 offset p_terminal_offset) x),'[]'::jsonb));
end $$;

create function api.change_administration(p_session_id uuid,p_key uuid,p_action text,p_target_id uuid,p_payload jsonb,p_admin_pin_proof text,p_notes text)
returns table(result jsonb) language plpgsql security definer set search_path = '' as $$
declare s private.staff_sessions; actor public.staff_profiles; target public.staff_profiles;
 t private.terminals; old private.administration_operations; proof text; response jsonb; changed uuid; n integer:=0; role_value public.staff_role; active_value boolean;
begin
 -- One lock order for all lifecycle writers, including cross-terminal actions.
 perform pg_advisory_xact_lock(hashtextextended('campuspay-staff-administration',0));
 s:=private.assert_session(p_session_id,'security.staff.manage');
 if s.role_snapshot<>'super_admin' then raise exception 'FORBIDDEN'; end if;
 if p_key is null or p_action is null or p_action not in ('CREATE_STAFF','UPDATE_STAFF','RESET_STAFF_PIN','REVOKE_STAFF_SESSIONS','UPDATE_TERMINAL','REVOKE_TERMINAL_SESSIONS')
  or jsonb_typeof(p_payload) is distinct from 'object' or p_notes is null or length(btrim(p_notes)) not between 10 and 500 or p_notes ~ '[[:cntrl:]]'
  or (p_action='CREATE_STAFF' and p_target_id is not null) or (p_action<>'CREATE_STAFF' and p_target_id is null) then raise exception 'BAD_REQUEST'; end if;
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
  select * into target from public.staff_profiles where auth_user_id=p_target_id for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  -- A checkout/open-drawer RPC holds its session lock until commit. Wait for
  -- those operations before checking drawer guards or revoking access.
  perform 1 from private.staff_sessions where auth_user_id=target.auth_user_id and revoked_at is null order by id for update;
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
  perform 1 from private.staff_sessions where terminal_id=p_target_id and revoked_at is null order by id for update;
  select * into t from private.terminals where id=p_target_id for update;
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

create function api.recover_administration(p_session_id uuid,p_key uuid)
returns table(result jsonb) language plpgsql security definer set search_path = '' as $$
declare s private.staff_sessions; old private.administration_operations;
begin
 if p_key is null then raise exception 'BAD_REQUEST'; end if;
 perform pg_advisory_xact_lock(hashtextextended('campuspay-staff-administration',0));
 s:=private.assert_session(p_session_id,'security.staff.manage');
 select * into old from private.administration_operations where request_key=p_key;
 if not found then
  insert into private.administration_operations(request_key,actor_id,terminal_id,action,request_proof,result)
  values(p_key,s.auth_user_id,s.terminal_id,'CLOSED','CLOSED',jsonb_build_object('outcome','CLOSED'));
  return query select jsonb_build_object('outcome','CLOSED'); return;
 end if;
 if old.actor_id<>s.auth_user_id or old.terminal_id<>s.terminal_id then raise exception 'FORBIDDEN'; end if;
 return query select old.result;
end $$;
-- Login must not create a session from a profile read before a concurrent
-- role/deactivation/PIN update. Preserve the previous implementation and its
-- lockout behavior; add the same lifecycle lock before credential verification.
do $$ declare definition text; anchor text := 'v_profile := private.verify_staff_pin(p_employee_code, p_pin_proof, null);'; begin
 definition:=pg_get_functiondef('api.create_staff_session(text,text,text,text)'::regprocedure);
 if strpos(definition,anchor)=0 then raise exception 'STAFF_LOGIN_PATCH_PRECONDITION'; end if;
 definition:=replace(definition,anchor,'perform pg_advisory_xact_lock(hashtextextended(''campuspay-staff-administration'',0)); '||anchor);
 execute definition;
end $$;
revoke all on function api.administration_snapshot(uuid,integer,integer),api.change_administration(uuid,uuid,text,uuid,jsonb,text,text),api.recover_administration(uuid,uuid) from public;
grant execute on function api.administration_snapshot(uuid,integer,integer),api.change_administration(uuid,uuid,text,uuid,jsonb,text,text),api.recover_administration(uuid,uuid) to campuspay_runtime;
insert into private.schema_migrations(version) values('20260918190000_staff_administration') on conflict do nothing;
