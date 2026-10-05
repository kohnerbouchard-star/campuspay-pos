create table private.staff_access_events (
 request_key uuid primary key, target_id uuid not null references public.staff_profiles(auth_user_id),
 actor_id uuid not null references public.staff_profiles(auth_user_id), terminal_id uuid not null references private.terminals(id),
 previous_preset text not null, new_preset text not null, previous_permissions text[] not null,
 new_permissions text[] not null, reason text not null, reference_number text not null unique,
 request_proof text not null, sessions_revoked integer not null, created_at timestamptz not null default clock_timestamp()
);
create trigger immutable_access_event before update or delete on private.staff_access_events
 for each row execute function private.reject_journal_mutation();
create table private.staff_access_closures (
 request_key uuid primary key, actor_id uuid not null references public.staff_profiles(auth_user_id),
 terminal_id uuid not null references private.terminals(id), created_at timestamptz not null default clock_timestamp()
);
create trigger immutable_access_closure before update or delete on private.staff_access_closures
 for each row execute function private.reject_journal_mutation();
revoke all on private.staff_access_events,private.staff_access_closures from public,campuspay_runtime;
create function private.is_access_administrator(p_user_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
 select exists(select 1 from public.staff_profiles p join private.staff_access a on a.user_id=p.auth_user_id
 join private.staff_credentials c on c.staff_user_id=p.auth_user_id
 where p.auth_user_id=p_user_id and p.active and p.role='super_admin' and a.preset='super_admin'
 and 'staff.access.manage'=any(a.permissions));
$$;
revoke all on function private.is_access_administrator(uuid) from public,campuspay_runtime;
create function api.employee_access(p_session_id uuid,p_target_id uuid) returns table(result jsonb)
language plpgsql security definer set search_path = '' as $$
declare s private.staff_sessions; begin
 s:=private.assert_session(p_session_id,'staff.access.manage');
 if not private.is_access_administrator(s.auth_user_id) then raise exception 'FORBIDDEN';end if;
 return query select jsonb_build_object('user_id',p.auth_user_id,'employee_code',p.employee_code,'display_name',p.display_name,
 'active',p.active,'preset',a.preset,'permissions',a.permissions,'revision',a.revision,'updated_at',a.updated_at,
 'defaults',(select permissions from private.access_preset_defaults where preset=a.preset),
 'history',case when private.has_capability(s.auth_user_id,'audit.read') then coalesce((select jsonb_agg(to_jsonb(e) order by e.created_at desc) from
 (select x.previous_preset,x.new_preset,x.previous_permissions,x.new_permissions,x.reason,x.reference_number,x.sessions_revoked,x.created_at,
 actor.display_name actor_name from private.staff_access_events x join public.staff_profiles actor on actor.auth_user_id=x.actor_id
 where x.target_id=p.auth_user_id order by x.created_at desc limit 50) e),'[]'::jsonb) else '[]'::jsonb end)
 from public.staff_profiles p join private.staff_access a on a.user_id=p.auth_user_id where p.auth_user_id=p_target_id;
end $$;
create function api.access_defaults(p_session_id uuid) returns table(preset text,permissions text[])
language plpgsql security definer set search_path = '' as $$ declare s private.staff_sessions;begin
 s:=private.assert_session(p_session_id,'staff.access.manage');
 if not private.is_access_administrator(s.auth_user_id) then raise exception 'FORBIDDEN';end if;
 return query select d.preset,d.permissions from private.access_preset_defaults d order by d.preset;
end $$;
create function api.change_employee_access(p_session_id uuid,p_key uuid,p_target_id uuid,p_expected_revision bigint,
 p_previous_preset text,p_previous_permissions text[],p_new_preset text,p_new_permissions text[],p_admin_pin_proof text,p_reason text,p_confirmed boolean)
returns table(result jsonb) language plpgsql security definer set search_path = '' as $$
declare s private.staff_sessions; actor public.staff_profiles; target public.staff_profiles; a private.staff_access;
 old private.staff_access_events; n integer:=0; proof text; proposed text[]; previous text[];
begin
 perform pg_advisory_xact_lock(hashtextextended('campuspay-staff-administration',0));
 select * into s from private.staff_sessions where id=p_session_id;
 if s.id is null or not private.is_access_administrator(s.auth_user_id) then raise exception 'FORBIDDEN';end if;
 -- Drain ALL affected sessions before touching credentials, access or profiles.
 perform 1 from private.staff_sessions ss where ss.id=p_session_id or (ss.auth_user_id=p_target_id and ss.revoked_at is null) order by ss.id for update;
 s:=private.assert_session(p_session_id,'staff.access.manage');
 if p_key is null or p_target_id is null or p_expected_revision is null or p_confirmed is distinct from true
 or p_reason is null or length(btrim(p_reason)) not between 10 and 500 or p_reason ~ '[[:cntrl:]]'
 or p_new_preset is null or p_new_preset not in ('staff','manager','accountant','super_admin')
 or not private.valid_access(p_new_permissions) or not private.valid_access(p_previous_permissions) then raise exception 'BAD_REQUEST';end if;
 select array_agg(x order by x) into proposed from unnest(p_new_permissions) x;
 select array_agg(x order by x) into previous from unnest(p_previous_permissions) x;
 proposed:=coalesce(proposed,array[]::text[]);previous:=coalesce(previous,array[]::text[]);
 proof:=encode(extensions.digest(jsonb_build_array(p_target_id,p_expected_revision,p_previous_preset,previous,p_new_preset,proposed,btrim(p_reason))::text,'sha256'),'hex');
 select * into old from private.staff_access_events where request_key=p_key;
 if found then
 if old.actor_id<>s.auth_user_id or old.terminal_id<>s.terminal_id or old.request_proof<>proof then raise exception 'CONFLICT';end if;
 return query select jsonb_build_object('outcome','COMPLETED','audit_reference',old.reference_number,'sessions_revoked',old.sessions_revoked);return;end if;
 if exists(select 1 from private.staff_access_closures where request_key=p_key) then raise exception 'CONFLICT';end if;
 if not (select administration_enabled from private.system_settings where singleton) then raise exception 'ADMINISTRATION_DISABLED';end if;
 actor:=private.verify_staff_pin(s.employee_code_snapshot,p_admin_pin_proof,'super_admin');
 if actor.auth_user_id is null then return query select jsonb_build_object('outcome','AUTH_FAILED');return;end if;
 select * into target from public.staff_profiles where auth_user_id=p_target_id for no key update;
 select * into a from private.staff_access where user_id=p_target_id for update;
 if target.auth_user_id is null or a.user_id is null then raise exception 'NOT_FOUND';end if;
 if a.revision<>p_expected_revision or a.preset is distinct from p_previous_preset or
 (select array_agg(x order by x) from unnest(a.permissions) x) is distinct from nullif(previous,array[]::text[]) then raise exception 'CONFLICT';end if;
 -- Self access editing is deliberately protected, including the final administrator.
 if p_target_id=s.auth_user_id then raise exception 'SELF_CHANGE_FORBIDDEN';end if;
 if private.is_access_administrator(p_target_id) and (p_new_preset<>'super_admin' or not 'staff.access.manage'=any(proposed))
 and not exists(select 1 from public.staff_profiles p where p.auth_user_id<>p_target_id and private.is_access_administrator(p.auth_user_id)) then raise exception 'LAST_ADMIN_REQUIRED';end if;
 if exists(select 1 from private.cash_shifts where opened_by=p_target_id and closed_at is null) then raise exception 'OPEN_CASH_SHIFT';end if;
 if 'staff.access.manage'=any(proposed) and p_new_preset<>'super_admin' then raise exception 'FORBIDDEN';end if;
 update private.staff_access set preset=p_new_preset,permissions=proposed,revision=revision+1,updated_at=clock_timestamp() where user_id=p_target_id;
 update public.staff_profiles set role=case p_new_preset when 'staff' then 'cashier'::public.staff_role when 'manager' then 'inventory_admin'::public.staff_role else p_new_preset::public.staff_role end,
 updated_at=clock_timestamp() where auth_user_id=p_target_id;
 update private.staff_sessions set revoked_at=clock_timestamp() where auth_user_id=p_target_id and revoked_at is null;
 get diagnostics n=row_count;
 insert into private.staff_access_events(request_key,target_id,actor_id,terminal_id,previous_preset,new_preset,previous_permissions,new_permissions,reason,reference_number,request_proof,sessions_revoked)
 values(p_key,p_target_id,s.auth_user_id,s.terminal_id,a.preset,p_new_preset,a.permissions,proposed,btrim(p_reason),'AUD-ACCESS-'||p_key,proof,n);
 insert into private.audit_events(event_type,actor_user_id,staff_session_id,subject_type,subject_id,reference_number,safe_payload)
 values('STAFF_ACCESS_CHANGED',s.auth_user_id,s.id,'STAFF',p_target_id,'AUD-ACCESS-'||p_key,
 jsonb_build_object('previous_preset',a.preset,'new_preset',p_new_preset,'previous_permissions',a.permissions,'new_permissions',proposed,'reason',btrim(p_reason),'sessions_revoked',n));
 return query select jsonb_build_object('outcome','COMPLETED','audit_reference','AUD-ACCESS-'||p_key,'sessions_revoked',n);
end $$;
create function api.recover_employee_access(p_session_id uuid,p_key uuid) returns table(result jsonb)
language plpgsql security definer set search_path = '' as $$ declare s private.staff_sessions;e private.staff_access_events;c private.staff_access_closures;begin
 perform pg_advisory_xact_lock(hashtextextended('campuspay-staff-administration',0));
 s:=private.assert_session(p_session_id,'staff.access.manage');
 if p_key is null or not private.is_access_administrator(s.auth_user_id) then raise exception 'FORBIDDEN';end if;
 select * into e from private.staff_access_events where request_key=p_key;
 if found then
 if e.actor_id<>s.auth_user_id or e.terminal_id<>s.terminal_id then raise exception 'FORBIDDEN';end if;
 return query select jsonb_build_object('outcome','COMPLETED','audit_reference',e.reference_number,'sessions_revoked',e.sessions_revoked);return;end if;
 select * into c from private.staff_access_closures where request_key=p_key;
 if found and (c.actor_id<>s.auth_user_id or c.terminal_id<>s.terminal_id) then raise exception 'FORBIDDEN';end if;
 insert into private.staff_access_closures(request_key,actor_id,terminal_id) values(p_key,s.auth_user_id,s.terminal_id) on conflict do nothing;
 return query select jsonb_build_object('outcome','CLOSED');end $$;
revoke all on function api.employee_access(uuid,uuid),api.access_defaults(uuid),api.change_employee_access(uuid,uuid,uuid,bigint,text,text[],text,text[],text,text,boolean),api.recover_employee_access(uuid,uuid) from public;
grant execute on function api.employee_access(uuid,uuid),api.access_defaults(uuid),api.change_employee_access(uuid,uuid,uuid,bigint,text,text[],text,text[],text,text,boolean),api.recover_employee_access(uuid,uuid) to campuspay_runtime;

insert into private.schema_migrations(version) values('20261005092000_staff_access_management') on conflict do nothing;
