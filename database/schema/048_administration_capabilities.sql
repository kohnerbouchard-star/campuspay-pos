-- Forward-only, counted edits preserve transaction bodies, idempotency, journals and locks.
create or replace function pg_temp.replace_access_boundary(signature text,anchor text,replacement text,expected integer) returns void
language plpgsql set search_path = '' as $$ declare definition text; n integer; begin
 definition:=pg_get_functiondef(signature::regprocedure);
 n:=(length(definition)-length(replace(definition,anchor,'')))/length(anchor);
 if n<>expected then raise exception 'ACCESS_BOUNDARY_PRECONDITION: % expected %, found %',signature,expected,n;end if;
 execute replace(definition,anchor,replacement);
end $$;

select pg_temp.replace_access_boundary('api.change_administration(uuid,uuid,text,uuid,jsonb,text,text)','if s.role_snapshot<>''super_admin''
  or not exists(select 1 from public.staff_profiles where auth_user_id=s.auth_user_id and active and role=''super_admin'')','if not exists(select 1 from public.staff_profiles where auth_user_id=s.auth_user_id and active)',1);

select pg_temp.replace_access_boundary('api.change_administration(uuid,uuid,text,uuid,jsonb,text,text)','s:=private.assert_session(p_session_id,''security.staff.manage'');','s:=private.assert_session(p_session_id,case when p_action like ''%TERMINAL%'' then ''terminals.manage'' else ''staff.manage'' end);
 if p_action=''CREATE_STAFF'' and not private.is_access_administrator(s.auth_user_id) then raise exception ''FORBIDDEN'';end if;',1);

select pg_temp.replace_access_boundary('api.change_administration(uuid,uuid,text,uuid,jsonb,text,text)','actor:=private.verify_staff_pin(s.employee_code_snapshot,p_admin_pin_proof,''super_admin'');','actor:=private.verify_staff_pin(s.employee_code_snapshot,p_admin_pin_proof,null);',1);

select pg_temp.replace_access_boundary('api.change_administration(uuid,uuid,text,uuid,jsonb,text,text)','insert into private.staff_credentials(staff_user_id,pin_hash) values(changed,extensions.crypt(p_payload->>''pin_proof'',extensions.gen_salt(''bf'',12)));','if p_payload->>''preset'' is null or p_payload->>''preset'' not in (''staff'',''manager'',''accountant'',''super_admin'') then raise exception ''BAD_REQUEST'';end if;
  if role_value::text<>(case p_payload->>''preset'' when ''staff'' then ''cashier'' when ''manager'' then ''inventory_admin'' else p_payload->>''preset'' end) then raise exception ''BAD_REQUEST'';end if;
  update private.staff_access set preset=p_payload->>''preset'',permissions=(select permissions from private.access_preset_defaults where preset=p_payload->>''preset'') where user_id=changed;
  insert into private.staff_credentials(staff_user_id,pin_hash) values(changed,extensions.crypt(p_payload->>''pin_proof'',extensions.gen_salt(''bf'',12)));',1);

select pg_temp.replace_access_boundary('api.change_administration(uuid,uuid,text,uuid,jsonb,text,text)','active_value:=(p_payload->>''active'')::boolean;
   if target.active','active_value:=(p_payload->>''active'')::boolean;
   if role_value<>target.role then raise exception ''FORBIDDEN'';end if;
   if private.is_access_administrator(target.auth_user_id) and not active_value and not exists(select 1 from public.staff_profiles p where p.auth_user_id<>target.auth_user_id and private.is_access_administrator(p.auth_user_id)) then raise exception ''LAST_ADMIN_REQUIRED'';end if;
   if target.active',1);

select pg_temp.replace_access_boundary('api.change_administration(uuid,uuid,text,uuid,jsonb,text,text)','jsonb_build_object(''action'',p_action,''notes'',btrim(p_notes),''sessions_revoked'',n)','jsonb_build_object(''action'',p_action,''notes'',btrim(p_notes),''sessions_revoked'',n,''preset'',(select preset from private.staff_access where user_id=changed),''effective_permissions'',(select permissions from private.staff_access where user_id=changed))',1);

select pg_temp.replace_access_boundary('api.recover_administration(uuid,uuid)','s:=private.assert_session(p_session_id,''security.staff.manage'');','s:=private.assert_session_any(p_session_id,array[''staff.manage'',''terminals.manage'']);',1);

create or replace function api.administration_snapshot(p_session_id uuid,p_staff_offset integer default 0,p_terminal_offset integer default 0)
returns table(result jsonb) language plpgsql security definer set search_path = '' as $$ declare s private.staff_sessions;begin
 s:=private.assert_session_any(p_session_id,array['staff.read','terminals.read']);
 if p_staff_offset is null or p_terminal_offset is null or p_staff_offset<0 or p_terminal_offset<0 then raise exception 'BAD_REQUEST';end if;
 return query select jsonb_build_object('enabled',(select administration_enabled from private.system_settings where singleton),'current_terminal_id',s.terminal_id,
 'staff_total',case when private.has_capability(s.auth_user_id,'staff.read') then (select count(*) from public.staff_profiles) else 0 end,
 'terminal_total',case when private.has_capability(s.auth_user_id,'terminals.read') then (select count(*) from private.terminals) else 0 end,
 'staff',case when private.has_capability(s.auth_user_id,'staff.read') then coalesce((select jsonb_agg(to_jsonb(x) order by x.employee_code,x.user_id) from
 (select sp.auth_user_id user_id,sp.employee_code,sp.display_name,sp.role,sp.active,sp.updated_at,a.preset,a.permissions,a.revision,
 exists(select 1 from private.staff_credentials c where c.staff_user_id=sp.auth_user_id) has_pin
 from public.staff_profiles sp join private.staff_access a on a.user_id=sp.auth_user_id order by sp.employee_code,sp.auth_user_id limit 50 offset p_staff_offset) x),'[]'::jsonb) else '[]'::jsonb end,
 'terminals',case when private.has_capability(s.auth_user_id,'terminals.read') then coalesce((select jsonb_agg(to_jsonb(x) order by x.last_seen_at desc,x.terminal_id) from
 (select t.id terminal_id,t.label,t.active,t.created_at,t.last_seen_at,
 exists(select 1 from private.cash_shifts c where c.terminal_id=t.id and c.closed_at is null) has_open_shift
 from private.terminals t order by t.last_seen_at desc,t.id limit 50 offset p_terminal_offset) x),'[]'::jsonb) else '[]'::jsonb end);
end $$;

select pg_temp.replace_access_boundary('api.change_administration(uuid,uuid,text,uuid,jsonb,text,text)','changed:=target.auth_user_id;','if (target.role=''super_admin'' or exists(select 1 from private.staff_access where user_id=target.auth_user_id and ''staff.access.manage''=any(permissions))) and not private.is_access_administrator(s.auth_user_id) then raise exception ''FORBIDDEN'';end if;
  changed:=target.auth_user_id;',1);

insert into private.schema_migrations(version) values('20261005093000_administration_capabilities') on conflict do nothing;
