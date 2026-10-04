-- Recoverable deletion of operational records. Never erase journals or credentials.
create table private.deleted_records (
 kind text not null check(kind in ('PRODUCT','STUDENT','STAFF','TERMINAL','COUPON')),
 target_id uuid not null, deleted boolean not null default true,
 previous_active boolean not null, deleted_at timestamptz not null,
 restored_at timestamptz, primary key(kind,target_id)
);
create table private.record_removal_operations (
 request_key uuid primary key, actor_id uuid not null references public.staff_profiles(auth_user_id),
 terminal_id uuid not null references private.terminals(id), kind text not null,
 request_proof text not null, result jsonb not null, created_at timestamptz not null default clock_timestamp()
);
create trigger immutable_journal before update or delete on private.record_removal_operations
 for each row execute function private.reject_journal_mutation();
revoke all on private.deleted_records,private.record_removal_operations from public,campuspay_runtime;

create function private.removal_snapshot(p_kind text,p_target_id uuid,p_actor_id uuid,p_terminal_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare state jsonb; tomb private.deleted_records; blocker text;
begin
 case p_kind
 when 'PRODUCT' then
  select jsonb_build_object('code',sku,'name',name,'active',active,'updated_at',updated_at,
   'category',category,'price',selling_price_won,'reorder_level',reorder_level) into state from public.products where id=p_target_id;
  if exists(select 1 from private.inventory_lots where product_id=p_target_id and quantity_remaining<>0) then blocker:='Remove the remaining stock through an audited stock adjustment first.';
  elsif exists(select 1 from private.online_order_items i join private.online_orders o on o.id=i.order_id where i.product_id=p_target_id and o.status in ('PLACED','PICKING','READY','OUT_FOR_DELIVERY')) then blocker:='Finish the open online orders first.'; end if;
 when 'STUDENT' then
  select jsonb_build_object('code',student_code,'name',display_name,'active',active,'updated_at',updated_at) into state from private.students where id=p_target_id;
  if exists(select 1 from private.wallets where student_id=p_target_id and balance_won<>0) then blocker:='Settle the wallet balance through the accounting workflow first.';
  elsif exists(select 1 from private.online_orders where student_id=p_target_id and status in ('PLACED','PICKING','READY','OUT_FOR_DELIVERY')) then blocker:='Finish the open online orders first.'; end if;
 when 'STAFF' then
  select jsonb_build_object('code',employee_code,'name',display_name,'active',active,'updated_at',updated_at,'role',role) into state from public.staff_profiles where auth_user_id=p_target_id;
  if p_target_id=p_actor_id then blocker:='You cannot delete your current account.';
  elsif exists(select 1 from private.cash_shifts where opened_by=p_target_id and closed_at is null) then blocker:='Close this staff member''s cash drawer first.';
  elsif state->>'role'='super_admin' and (state->>'active')::boolean and not exists(select 1 from public.staff_profiles where active and role='super_admin' and auth_user_id<>p_target_id) then blocker:='An active Super Admin must remain.'; end if;
 when 'TERMINAL' then
  select jsonb_build_object('code',id::text,'name',coalesce(label,'Unlabelled register'),'active',active,'label',label) into state from private.terminals where id=p_target_id;
  if p_target_id=p_terminal_id then blocker:='Use another register to delete this register.';
  elsif exists(select 1 from private.cash_shifts where terminal_id=p_target_id and closed_at is null) then blocker:='Close this register''s cash drawer first.'; end if;
 when 'COUPON' then
  select jsonb_build_object('code',id::text,'name',name,'active',active,'deactivated_at',deactivated_at) into state from private.coupons where id=p_target_id;
 else raise exception 'BAD_REQUEST';
 end case;
 if state is null then raise exception 'NOT_FOUND'; end if;
 select * into tomb from private.deleted_records where kind=p_kind and target_id=p_target_id;
 return jsonb_build_object('kind',p_kind,'target_id',p_target_id,'name',state->>'name','code',state->>'code',
  'active',(state->>'active')::boolean,'deleted',coalesce(tomb.deleted,false),'deleted_at',tomb.deleted_at,
  'restore_active',tomb.previous_active,'blocker',case when coalesce(tomb.deleted,false) then null else blocker end,
  'version',encode(extensions.digest(jsonb_build_array(p_kind,p_target_id,state,to_jsonb(tomb))::text,'sha256'),'hex'));
end $$;
revoke all on function private.removal_snapshot(text,uuid,uuid,uuid) from public,campuspay_runtime;

create function api.removal_directory(p_session_id uuid,p_kind text,p_target_id uuid,p_offset integer)
returns table(result jsonb) language plpgsql security definer set search_path = '' as $$
declare s private.staff_sessions;
begin
 s:=private.assert_session(p_session_id,'security.staff.manage');
 if s.role_snapshot<>'super_admin' then raise exception 'FORBIDDEN'; end if;
 if p_kind is null or p_kind not in ('ALL','PRODUCT','STUDENT','STAFF','TERMINAL','COUPON') or p_offset is null or p_offset not between 0 and 1000000 or (p_target_id is not null and p_kind='ALL') then raise exception 'BAD_REQUEST'; end if;
 if p_target_id is not null then
  return query select jsonb_build_object('enabled',(select administration_enabled from private.system_settings where singleton),'total',1,'records',jsonb_build_array(private.removal_snapshot(p_kind,p_target_id,s.auth_user_id,s.terminal_id))); return;
 end if;
 return query select jsonb_build_object('enabled',(select administration_enabled from private.system_settings where singleton),'total',(select count(*) from private.deleted_records d where d.deleted and (p_kind='ALL' or d.kind=p_kind)),
  'records',coalesce((select jsonb_agg(x.item order by x.deleted_at desc,x.kind,x.target_id) from (
   select d.deleted_at,d.kind,d.target_id,private.removal_snapshot(d.kind,d.target_id,s.auth_user_id,s.terminal_id) item
   from private.deleted_records d where d.deleted and (p_kind='ALL' or d.kind=p_kind)
   order by d.deleted_at desc,d.kind,d.target_id limit 50 offset p_offset) x),'[]'::jsonb));
end $$;

create function api.change_record_removal(p_session_id uuid,p_key uuid,p_kind text,p_action text,p_target_id uuid,p_version text,p_admin_pin_proof text,p_notes text)
returns table(result jsonb) language plpgsql security definer set search_path = '' as $$
declare s private.staff_sessions; actor public.staff_profiles; old private.record_removal_operations;
 snapshot jsonb; tomb private.deleted_records; proof text; response jsonb; desired boolean; balance bigint;
begin
 if p_key is null or p_kind is null or p_kind not in ('PRODUCT','STUDENT','STAFF','TERMINAL','COUPON') or p_action is null or p_action not in ('DELETE','RESTORE') or p_target_id is null or p_version is null or p_version !~ '^[0-9a-f]{64}$' or p_notes is null or length(btrim(p_notes)) not between 10 and 500 or p_notes ~ '[[:cntrl:]]' then raise exception 'BAD_REQUEST'; end if;
 perform set_config('lock_timeout','5s',true);
 perform pg_advisory_xact_lock(hashtextextended('campuspay-staff-administration',0));
 -- Drain affected sessions BEFORE assert_session takes the actor's terminal.
 select * into s from private.staff_sessions where id=p_session_id;
 if s.id is null or s.revoked_at is not null or s.expires_at<=clock_timestamp() or s.created_at+interval '8 hours'<=clock_timestamp() then raise exception 'SESSION_EXPIRED'; end if;
 if s.role_snapshot<>'super_admin' or not exists(select 1 from public.staff_profiles where auth_user_id=s.auth_user_id and active and role='super_admin') or not exists(select 1 from private.terminals where id=s.terminal_id and active) then raise exception 'FORBIDDEN'; end if;
 perform 1 from private.staff_sessions ss where ss.id=p_session_id or (ss.revoked_at is null and (
  (p_kind='STAFF' and ss.auth_user_id=p_target_id) or (p_kind='TERMINAL' and ss.terminal_id=p_target_id))) order by ss.id for update;
 s:=private.assert_session(p_session_id,'security.staff.manage');
 perform pg_advisory_xact_lock(hashtextextended(p_key::text,40405));
 proof:=encode(extensions.digest(jsonb_build_array(p_kind,p_action,p_target_id,p_version,btrim(p_notes))::text,'sha256'),'hex');
 select * into old from private.record_removal_operations where request_key=p_key;
 if found then
  if old.actor_id<>s.auth_user_id or old.terminal_id<>s.terminal_id or old.kind<>p_kind then raise exception 'FORBIDDEN'; end if;
  if old.result->>'outcome'<>'CLOSED' and old.request_proof<>proof then raise exception 'CONFLICT'; end if;
  return query select old.result; return;
 end if;
 if not (select administration_enabled from private.system_settings where singleton) then raise exception 'ADMINISTRATION_DISABLED'; end if;
 actor:=private.verify_staff_pin(s.employee_code_snapshot,p_admin_pin_proof,'super_admin');
 if actor.auth_user_id is null then return query select jsonb_build_object('outcome','AUTH_FAILED'); return; end if;
 case p_kind
 when 'PRODUCT' then perform 1 from public.products where id=p_target_id for update;
 when 'STUDENT' then
  perform pg_advisory_xact_lock(hashtextextended('campuspay-student-lifecycle:'||p_target_id::text,40404));
  select balance_won into balance from private.wallets where student_id=p_target_id for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  perform 1 from private.students where id=p_target_id for no key update;
 when 'STAFF' then perform 1 from public.staff_profiles where auth_user_id=p_target_id for no key update;
 when 'TERMINAL' then perform 1 from private.terminals where id=p_target_id for no key update;
 when 'COUPON' then perform 1 from private.coupons where id=p_target_id for update;
 end case;
 snapshot:=private.removal_snapshot(p_kind,p_target_id,s.auth_user_id,s.terminal_id);
 if snapshot->>'version'<>p_version then raise exception 'RECORD_STALE'; end if;
 if (snapshot->>'deleted')::boolean is distinct from (p_action='RESTORE') then raise exception 'RECORD_STALE'; end if;
 select * into tomb from private.deleted_records where kind=p_kind and target_id=p_target_id for update;
 desired:=case when p_action='DELETE' then false else tomb.previous_active end;
 if p_action='DELETE' and snapshot->>'blocker' is not null then
  if p_kind='PRODUCT' and exists(select 1 from private.inventory_lots where product_id=p_target_id and quantity_remaining<>0) then raise exception 'RECORD_HAS_STOCK'; end if;
  if p_kind='STUDENT' and balance<>0 then raise exception 'RECORD_HAS_BALANCE'; end if;
  if p_kind in ('STAFF','TERMINAL') then
   if p_target_id in (s.auth_user_id,s.terminal_id) then raise exception 'SELF_CHANGE_FORBIDDEN'; end if;
   if p_kind='STAFF' and snapshot->>'blocker'='An active Super Admin must remain.' then raise exception 'LAST_ADMIN_REQUIRED'; end if;
   raise exception 'OPEN_CASH_SHIFT';
  end if;
  raise exception 'RECORD_HAS_ORDERS';
 end if;
 -- Clear the tombstone inside this transaction before restoring availability.
 if p_action='RESTORE' then update private.deleted_records set deleted=false,restored_at=clock_timestamp() where kind=p_kind and target_id=p_target_id; end if;
 case p_kind
 when 'PRODUCT' then update public.products set active=desired,updated_at=clock_timestamp() where id=p_target_id;
 when 'STUDENT' then
  update private.students set active=desired,updated_at=clock_timestamp() where id=p_target_id;
  update private.customer_sessions set revoked_at=clock_timestamp() where student_id=p_target_id and revoked_at is null;
 when 'STAFF' then
  update public.staff_profiles set active=desired,updated_at=clock_timestamp() where auth_user_id=p_target_id;
  update private.staff_sessions set revoked_at=clock_timestamp() where auth_user_id=p_target_id and revoked_at is null;
 when 'TERMINAL' then
  update private.terminals set active=desired where id=p_target_id;
  update private.staff_sessions set revoked_at=clock_timestamp() where terminal_id=p_target_id and revoked_at is null;
 when 'COUPON' then
  update private.coupons set active=desired,deactivated_at=case when desired then null else clock_timestamp() end,
   deactivated_by=case when desired then null else s.auth_user_id end,deactivated_session_id=case when desired then null else s.id end,
   deactivation_reason=case when desired then null else btrim(p_notes) end where id=p_target_id;
 end case;
 if p_action='DELETE' then
  insert into private.deleted_records(kind,target_id,previous_active,deleted_at) values(p_kind,p_target_id,(snapshot->>'active')::boolean,clock_timestamp())
  on conflict(kind,target_id) do update set deleted=true,previous_active=excluded.previous_active,deleted_at=excluded.deleted_at,restored_at=null;
 end if;
 response:=jsonb_build_object('outcome','COMPLETED','kind',p_kind,'target_id',p_target_id,'deleted',p_action='DELETE','audit_reference','AUD-REMOVE-'||p_key);
 insert into private.record_removal_operations(request_key,actor_id,terminal_id,kind,request_proof,result) values(p_key,s.auth_user_id,s.terminal_id,p_kind,proof,response);
 insert into private.audit_events(event_type,actor_user_id,staff_session_id,subject_type,subject_id,reference_number,safe_payload)
 values('RECORD_REMOVAL_CHANGED',s.auth_user_id,s.id,p_kind,p_target_id,'AUD-REMOVE-'||p_key,jsonb_build_object('action',p_action,'reason',btrim(p_notes),'code',snapshot->>'code','name',snapshot->>'name','active_before',(snapshot->>'active')::boolean,'active_after',desired,'history_preserved',true));
 return query select response;
end $$;

create function api.recover_record_removal(p_session_id uuid,p_key uuid,p_kind text)
returns table(result jsonb) language plpgsql security definer set search_path = '' as $$
declare s private.staff_sessions; old private.record_removal_operations; response jsonb;
begin
 if p_key is null or p_kind is null or p_kind not in ('PRODUCT','STUDENT','STAFF','TERMINAL','COUPON') then raise exception 'BAD_REQUEST'; end if;
 perform pg_advisory_xact_lock(hashtextextended('campuspay-staff-administration',0));
 s:=private.assert_session(p_session_id,'security.staff.manage');
 if s.role_snapshot<>'super_admin' then raise exception 'FORBIDDEN'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_key::text,40405));
 select * into old from private.record_removal_operations where request_key=p_key;
 if found then
  if old.actor_id<>s.auth_user_id or old.terminal_id<>s.terminal_id or old.kind<>p_kind then raise exception 'FORBIDDEN'; end if;
  return query select old.result; return;
 end if;
 response:=jsonb_build_object('outcome','CLOSED');
 insert into private.record_removal_operations(request_key,actor_id,terminal_id,kind,request_proof,result) values(p_key,s.auth_user_id,s.terminal_id,p_kind,'CLOSED',response);
 insert into private.audit_events(event_type,actor_user_id,staff_session_id,subject_type,subject_id,reference_number,safe_payload)
 values('RECORD_REMOVAL_REQUEST_CLOSED',s.auth_user_id,s.id,'RECORD_REQUEST',p_key,'AUD-REMOVE-CLOSE-'||p_key,jsonb_build_object('kind',p_kind));
 return query select response;
end $$;
revoke all on function api.removal_directory(uuid,text,uuid,integer),api.change_record_removal(uuid,uuid,text,text,uuid,text,text,text),api.recover_record_removal(uuid,uuid,text) from public;
grant execute on function api.removal_directory(uuid,text,uuid,integer),api.change_record_removal(uuid,uuid,text,text,uuid,text,text,text),api.recover_record_removal(uuid,uuid,text) to campuspay_runtime;

-- Legacy availability editors cannot reactivate a deleted identity.
create function private.block_removed_activation() returns trigger language plpgsql security definer set search_path = '' as $$
begin
 if new.active and exists(select 1 from private.deleted_records d where d.kind=tg_argv[0] and d.target_id=(to_jsonb(new)->>tg_argv[1])::uuid and d.deleted) then raise exception 'RECORD_REMOVED'; end if;
 return new;
end $$;
revoke all on function private.block_removed_activation() from public,campuspay_runtime;
create trigger removed_activation before update on public.products for each row execute function private.block_removed_activation('PRODUCT','id');
create trigger removed_activation before update on private.students for each row execute function private.block_removed_activation('STUDENT','id');
create trigger removed_activation before update on public.staff_profiles for each row execute function private.block_removed_activation('STAFF','auth_user_id');
create trigger removed_activation before update on private.terminals for each row execute function private.block_removed_activation('TERMINAL','id');
create trigger removed_activation before update on private.coupons for each row execute function private.block_removed_activation('COUPON','id');

-- Filter BEFORE pagination/counts; financial reporting keeps all identities.
do $$
declare r record; definition text;
begin
 for r in select * from (values
 ('api.record_directory(uuid,text,text,text,integer,uuid)','from public.products p where (p_target_id','from public.products p where not exists(select 1 from private.deleted_records d where d.kind=''PRODUCT'' and d.target_id=p.id and d.deleted) and (p_target_id'),
 ('api.record_directory(uuid,text,text,text,integer,uuid)','where (p_target_id is null or s.id=p_target_id)','where not exists(select 1 from private.deleted_records d where d.kind=''STUDENT'' and d.target_id=s.id and d.deleted) and (p_target_id is null or s.id=p_target_id)'),
 ('api.search_students_v2(uuid,text,integer,integer)','where (p_year_group','where not exists(select 1 from private.deleted_records d where d.kind=''STUDENT'' and d.target_id=s.id and d.deleted) and (p_year_group'),
 ('api.administration_snapshot(uuid,integer,integer)','count(*) from public.staff_profiles)','count(*) from public.staff_profiles sp where not exists(select 1 from private.deleted_records d where d.kind=''STAFF'' and d.target_id=sp.auth_user_id and d.deleted))'),
 ('api.administration_snapshot(uuid,integer,integer)','count(*) from private.terminals)','count(*) from private.terminals t where not exists(select 1 from private.deleted_records d where d.kind=''TERMINAL'' and d.target_id=t.id and d.deleted))'),
 ('api.administration_snapshot(uuid,integer,integer)','from public.staff_profiles sp order by','from public.staff_profiles sp where not exists(select 1 from private.deleted_records d where d.kind=''STAFF'' and d.target_id=sp.auth_user_id and d.deleted) order by'),
 ('api.administration_snapshot(uuid,integer,integer)','from private.terminals t order by','from private.terminals t where not exists(select 1 from private.deleted_records d where d.kind=''TERMINAL'' and d.target_id=t.id and d.deleted) order by'),
 ('api.search_students(uuid,text)',
 $filter$where coalesce(btrim(p_query), '') = '' or s.id::text = p_query
    or strpos(lower(s.student_code), lower(btrim(p_query))) > 0
    or strpos(lower(s.display_name), lower(btrim(p_query))) > 0$filter$,
 $filter$where not exists(select 1 from private.deleted_records d where d.kind='STUDENT' and d.target_id=s.id and d.deleted) and (coalesce(btrim(p_query), '') = '' or s.id::text = p_query
    or strpos(lower(s.student_code), lower(btrim(p_query))) > 0
    or strpos(lower(s.display_name), lower(btrim(p_query))) > 0)$filter$),
 ('api.list_coupons(uuid)','group by c.id','where not exists(select 1 from private.deleted_records d where d.kind=''COUPON'' and d.target_id=c.id and d.deleted) group by c.id'),
 ('api.list_coupons_v2(uuid)','group by c.id','where not exists(select 1 from private.deleted_records d where d.kind=''COUPON'' and d.target_id=c.id and d.deleted) group by c.id')
 ) patches(signature,anchor,replacement) loop
  definition:=pg_get_functiondef(r.signature::regprocedure);
  if (length(definition)-length(replace(definition,r.anchor,'')))/length(r.anchor)<>1 then raise exception 'REMOVAL_DIRECTORY_PATCH_PRECONDITION: %',r.signature; end if;
  execute replace(definition,r.anchor,r.replacement);
 end loop;
end $$;
