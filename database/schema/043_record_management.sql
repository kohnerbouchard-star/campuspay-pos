-- Additive, audited archive/deactivation workflows. Never hard-delete financial identities.
-- Does not activate staff administration or change any existing account, stock or balance.
create table private.record_management_operations (
 request_key uuid primary key,
 actor_id uuid not null references public.staff_profiles(auth_user_id),
 terminal_id uuid not null references private.terminals(id),
 kind text not null check(kind in ('PRODUCT','STUDENT')),
 request_proof text not null,
 result jsonb not null,
 created_at timestamptz not null default clock_timestamp()
);
create trigger immutable_journal before update or delete on private.record_management_operations
 for each row execute function private.reject_journal_mutation();
revoke all on private.record_management_operations from public,campuspay_runtime;

create unique index products_sku_lower_key on public.products(lower(sku));

alter function api.create_product(uuid,text,text,text,bigint,integer) set schema private;
alter function private.create_product(uuid,text,text,text,bigint,integer) rename to create_product_legacy;
revoke all on function private.create_product_legacy(uuid,text,text,text,bigint,integer) from public,campuspay_runtime;
alter function api.change_product_price(uuid,uuid,bigint,text) set schema private;
alter function private.change_product_price(uuid,uuid,bigint,text) rename to change_product_price_legacy;
revoke all on function private.change_product_price_legacy(uuid,uuid,bigint,text) from public,campuspay_runtime;

create function api.record_directory(p_session_id uuid,p_kind text,p_query text,p_status text,p_offset integer,p_target_id uuid)
returns table(result jsonb) language plpgsql security definer set search_path = '' as $$
begin
 if p_kind is null or p_kind not in ('PRODUCT','STUDENT') or p_query is null or length(p_query)>120
  or p_status is null or p_status not in ('ALL','ACTIVE','INACTIVE') or p_offset is null or p_offset not between 0 and 1000000 then raise exception 'BAD_REQUEST'; end if;
 perform private.assert_session(p_session_id,case when p_kind='PRODUCT' then 'inventory.read' else 'students.manage' end);
 if p_kind='PRODUCT' then
  return query with matched as (
   select p.id,p.sku code,p.name,p.active,p.updated_at,p.category,p.reorder_level,p.selling_price_won,
    (select coalesce(sum(l.quantity_remaining),0) from private.inventory_lots l where l.product_id=p.id) quantity_or_balance,
    exists(select 1 from private.online_order_items i join private.online_orders o on o.id=i.order_id where i.product_id=p.id and o.status in ('PLACED','PICKING','READY','OUT_FOR_DELIVERY')) has_orders
   from public.products p where (p_target_id is null or p.id=p_target_id)
    and (p_status='ALL' or p.active=(p_status='ACTIVE'))
    and (position(lower(btrim(p_query)) in lower(p.name||' '||p.sku||' '||p.category))>0)
  ) select jsonb_build_object('kind',p_kind,'total',(select count(*) from matched),'records',coalesce((select jsonb_agg(to_jsonb(x) order by x.name,x.id) from (
   select id,code,name,active,updated_at,category,reorder_level,selling_price_won,quantity_or_balance,
    case when active and quantity_or_balance<>0 then 'Record remaining stock removal or supplier return before archiving.'
     when active and has_orders then 'Complete the open online orders before archiving.' else null end blocker
   from matched order by name,id limit 50 offset p_offset) x),'[]'::jsonb));
 else
  return query with matched as (
   select s.id,s.student_code code,s.display_name name,s.active,s.updated_at,null::text category,null::integer reorder_level,null::bigint selling_price_won,
    w.balance_won quantity_or_balance,
    exists(select 1 from private.online_orders o where o.student_id=s.id and o.status in ('PLACED','PICKING','READY','OUT_FOR_DELIVERY')) has_orders
   from private.students s join private.wallets w on w.student_id=s.id
   where (p_target_id is null or s.id=p_target_id) and (p_status='ALL' or s.active=(p_status='ACTIVE'))
    and position(lower(btrim(p_query)) in lower(s.display_name||' '||s.student_code))>0
  ) select jsonb_build_object('kind',p_kind,'total',(select count(*) from matched),'records',coalesce((select jsonb_agg(to_jsonb(x) order by x.name,x.id) from (
   select id,code,name,active,updated_at,category,reorder_level,selling_price_won,quantity_or_balance,
    case when active and quantity_or_balance<>0 then 'Settle the wallet balance through the authorized accounting workflow first.'
     when active and has_orders then 'Complete the open online orders before deactivating this student.' else null end blocker
   from matched order by name,id limit 50 offset p_offset) x),'[]'::jsonb));
 end if;
end $$;

create function api.change_record(p_session_id uuid,p_key uuid,p_kind text,p_action text,p_target_id uuid,p_payload jsonb,p_admin_pin_proof text,p_notes text)
returns table(result jsonb) language plpgsql security definer set search_path = '' as $$
declare s private.staff_sessions; actor public.staff_profiles; p public.products; st private.students;
 old private.record_management_operations; proof text; response jsonb; target uuid; balance bigint; desired boolean; allowed text[]; expected timestamptz; audit_details jsonb := '{}'::jsonb;
begin
 if p_kind is null or p_kind not in ('PRODUCT','STUDENT') or p_key is null or p_action is null
  or (p_kind='PRODUCT' and p_action not in ('CREATE_PRODUCT','UPDATE_PRODUCT','CHANGE_PRODUCT_PRICE','ARCHIVE_PRODUCT','RESTORE_PRODUCT'))
  or (p_kind='STUDENT' and p_action not in ('DEACTIVATE_STUDENT','REACTIVATE_STUDENT'))
  or jsonb_typeof(p_payload) is distinct from 'object' or p_notes is null or length(btrim(p_notes)) not between 10 and 500 or p_notes ~ '[[:cntrl:]]'
  or (p_action='CREATE_PRODUCT' and p_target_id is not null) or (p_action<>'CREATE_PRODUCT' and p_target_id is null) then raise exception 'BAD_REQUEST'; end if;
 allowed:=case p_action when 'CREATE_PRODUCT' then array['sku','name','category','selling_price_won','reorder_level']
  when 'UPDATE_PRODUCT' then array['expected_updated_at','name','category','reorder_level']
  when 'CHANGE_PRODUCT_PRICE' then array['expected_updated_at','selling_price_won'] else array['expected_updated_at'] end;
 if exists(select 1 from jsonb_object_keys(p_payload) k(name) where k.name<>all(allowed)) then raise exception 'BAD_REQUEST';end if;
 if p_action<>'CREATE_PRODUCT' then
  if jsonb_typeof(p_payload->'expected_updated_at') is distinct from 'string' then raise exception 'BAD_REQUEST';end if;
  begin expected:=(p_payload->>'expected_updated_at')::timestamptz;
  exception when invalid_datetime_format or datetime_field_overflow then raise exception 'BAD_REQUEST';end;
  if not isfinite(expected) then raise exception 'BAD_REQUEST';end if;
 end if;
 -- Match staff administration/login ordering before taking the caller's session/terminal.
 perform pg_advisory_xact_lock(hashtextextended('campuspay-staff-administration',0));
 s:=private.assert_session(p_session_id,case when p_kind='PRODUCT' then 'inventory.product.manage' else 'students.manage' end);
 if p_kind='STUDENT' and s.role_snapshot<>'super_admin' then raise exception 'FORBIDDEN'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_key::text,40403));
 proof:=encode(extensions.digest(jsonb_build_array(p_kind,p_action,p_target_id,p_payload,btrim(p_notes))::text,'sha256'),'hex');
 select * into old from private.record_management_operations where request_key=p_key;
 if found then
  if old.actor_id<>s.auth_user_id or old.terminal_id<>s.terminal_id or old.kind<>p_kind then raise exception 'FORBIDDEN'; end if;
  if old.result->>'outcome'<>'CLOSED' and old.request_proof<>proof then raise exception 'CONFLICT'; end if;
  return query select old.result;return;
 end if;
 if p_kind='STUDENT' then
  actor:=private.verify_staff_pin(s.employee_code_snapshot,p_admin_pin_proof,'super_admin');
  if actor.auth_user_id is null then return query select jsonb_build_object('outcome','AUTH_FAILED');return;end if;
 end if;
 if p_action in ('CREATE_PRODUCT','UPDATE_PRODUCT') then
  if jsonb_typeof(p_payload->'name') is distinct from 'string' or length(btrim(p_payload->>'name')) not between 1 and 120 or p_payload->>'name' ~ '[[:cntrl:]]'
   or jsonb_typeof(p_payload->'category') is distinct from 'string' or length(btrim(p_payload->>'category')) not between 1 and 80 or p_payload->>'category' ~ '[[:cntrl:]]'
   or jsonb_typeof(p_payload->'reorder_level') is distinct from 'number' or p_payload->>'reorder_level' !~ '^[0-9]+$'
   or (p_payload->>'reorder_level')::numeric not between 0 and 1000000 then raise exception 'BAD_REQUEST'; end if;
 end if;
 if p_action='CREATE_PRODUCT' then
  if jsonb_typeof(p_payload->'sku') is distinct from 'string' or length(btrim(p_payload->>'sku')) not between 1 and 40 or p_payload->>'sku' ~ '[[:cntrl:]]'
   or jsonb_typeof(p_payload->'selling_price_won') is distinct from 'number' or p_payload->>'selling_price_won' !~ '^[0-9]+$'
   or (p_payload->>'selling_price_won')::numeric not between 0 and 10000000 then raise exception 'BAD_REQUEST'; end if;
  if exists(select 1 from public.products where lower(sku)=lower(btrim(p_payload->>'sku'))) then raise exception 'RECORD_CODE_EXISTS'; end if;
  select reference_id into target from private.create_product_legacy(s.id,btrim(p_payload->>'sku'),btrim(p_payload->>'name'),btrim(p_payload->>'category'),(p_payload->>'selling_price_won')::bigint,(p_payload->>'reorder_level')::integer);
  audit_details:=jsonb_build_object('after',jsonb_build_object('sku',btrim(p_payload->>'sku'),'name',btrim(p_payload->>'name'),'category',btrim(p_payload->>'category'),'selling_price_won',(p_payload->>'selling_price_won')::bigint,'reorder_level',(p_payload->>'reorder_level')::integer,'active',true));
 elsif p_kind='PRODUCT' then
  select * into p from public.products where id=p_target_id for update;
  if not found then raise exception 'NOT_FOUND';end if;
  if p_payload->>'expected_updated_at' is null then raise exception 'BAD_REQUEST';end if;
  if p.updated_at is distinct from expected then raise exception 'RECORD_STALE';end if;
  target:=p.id;
  if p_action='CHANGE_PRODUCT_PRICE' then
   if not private.role_has_permission(s.role_snapshot,'inventory.price.manage') then raise exception 'FORBIDDEN';end if;
   if not p.active then raise exception 'RECORD_STALE';end if;
   if jsonb_typeof(p_payload->'selling_price_won') is distinct from 'number' or p_payload->>'selling_price_won' !~ '^[0-9]+$' or (p_payload->>'selling_price_won')::numeric not between 0 and 10000000 then raise exception 'BAD_REQUEST';end if;
   audit_details:=jsonb_build_object('before',jsonb_build_object('selling_price_won',p.selling_price_won),'after',jsonb_build_object('selling_price_won',(p_payload->>'selling_price_won')::bigint));
   perform private.change_product_price_legacy(s.id,p.id,(p_payload->>'selling_price_won')::bigint,btrim(p_notes));
  elsif p_action='UPDATE_PRODUCT' then
   if not p.active then raise exception 'RECORD_STALE';end if;
   audit_details:=jsonb_build_object(
    'before',jsonb_build_object('name',p.name,'category',p.category,'reorder_level',p.reorder_level),
    'after',jsonb_build_object('name',btrim(p_payload->>'name'),'category',btrim(p_payload->>'category'),'reorder_level',(p_payload->>'reorder_level')::integer));
   update public.products set name=btrim(p_payload->>'name'),category=btrim(p_payload->>'category'),reorder_level=(p_payload->>'reorder_level')::integer,updated_at=clock_timestamp() where id=p.id;
  else
   desired:=p_action='RESTORE_PRODUCT';
   if p.active=desired then raise exception 'RECORD_STALE';end if;
   if not desired and exists(select 1 from private.inventory_lots where product_id=p.id and quantity_remaining<>0) then raise exception 'RECORD_HAS_STOCK';end if;
   if not desired and exists(select 1 from private.online_order_items i join private.online_orders o on o.id=i.order_id where i.product_id=p.id and o.status in ('PLACED','PICKING','READY','OUT_FOR_DELIVERY')) then raise exception 'RECORD_HAS_ORDERS';end if;
   audit_details:=jsonb_build_object('before',jsonb_build_object('active',p.active),'after',jsonb_build_object('active',desired));
   update public.products set active=desired,updated_at=clock_timestamp() where id=p.id;
  end if;
 else
  -- Per-student lifecycle lock fences session creation without a table-level cycle.
  -- Wallet-before-student matches financial writers and avoids wallet/student deadlocks.
  perform set_config('lock_timeout','5s',true);
  perform pg_advisory_xact_lock(hashtextextended('campuspay-student-lifecycle:'||p_target_id::text,40404));
  select balance_won into balance from private.wallets where student_id=p_target_id for update;
  if not found then raise exception 'NOT_FOUND';end if;
  select * into st from private.students where id=p_target_id for update;
  if not found then raise exception 'NOT_FOUND';end if;
  if p_payload->>'expected_updated_at' is null then raise exception 'BAD_REQUEST';end if;
  if st.updated_at is distinct from expected then raise exception 'RECORD_STALE';end if;
  desired:=p_action='REACTIVATE_STUDENT';
  if st.active=desired then raise exception 'RECORD_STALE';end if;
  if not desired and balance<>0 then raise exception 'RECORD_HAS_BALANCE';end if;
  if not desired and exists(select 1 from private.online_orders where student_id=st.id and status in ('PLACED','PICKING','READY','OUT_FOR_DELIVERY')) then raise exception 'RECORD_HAS_ORDERS';end if;
  target:=st.id;
  audit_details:=jsonb_build_object('before',jsonb_build_object('active',st.active),'after',jsonb_build_object('active',desired));
  update private.students set active=desired,updated_at=clock_timestamp() where id=st.id;
  -- Reactivation also invalidates any old session; it never reissues a PIN or card.
  update private.customer_sessions set revoked_at=clock_timestamp() where student_id=st.id and revoked_at is null;
 end if;
 response:=jsonb_build_object('outcome','COMPLETED','target_id',target,'audit_reference','AUD-RECORD-'||p_key);
 insert into private.record_management_operations(request_key,actor_id,terminal_id,kind,request_proof,result) values(p_key,s.auth_user_id,s.terminal_id,p_kind,proof,response);
 insert into private.audit_events(event_type,actor_user_id,staff_session_id,subject_type,subject_id,reference_number,safe_payload)
 values('RECORD_MANAGEMENT_CHANGED',s.auth_user_id,s.id,p_kind,target,'AUD-RECORD-'||p_key,jsonb_build_object('action',p_action,'reason',btrim(p_notes),'history_preserved',true)||audit_details);
 return query select response;
end $$;

create function api.recover_record_operation(p_session_id uuid,p_key uuid,p_kind text)
returns table(result jsonb) language plpgsql security definer set search_path = '' as $$
declare s private.staff_sessions;old private.record_management_operations;response jsonb;
begin
 if p_key is null or p_kind is null or p_kind not in ('PRODUCT','STUDENT') then raise exception 'BAD_REQUEST';end if;
 perform pg_advisory_xact_lock(hashtextextended('campuspay-staff-administration',0));
 s:=private.assert_session(p_session_id,case when p_kind='PRODUCT' then 'inventory.product.manage' else 'students.manage' end);
 perform pg_advisory_xact_lock(hashtextextended(p_key::text,40403));
 select * into old from private.record_management_operations where request_key=p_key;
 if found then
  if old.actor_id<>s.auth_user_id or old.terminal_id<>s.terminal_id or old.kind<>p_kind then raise exception 'FORBIDDEN';end if;
  return query select old.result;return;
 end if;
 response:=jsonb_build_object('outcome','CLOSED');
 insert into private.record_management_operations(request_key,actor_id,terminal_id,kind,request_proof,result) values(p_key,s.auth_user_id,s.terminal_id,p_kind,'CLOSED',response);
 insert into private.audit_events(event_type,actor_user_id,staff_session_id,subject_type,subject_id,reference_number,safe_payload)
 values('RECORD_MANAGEMENT_REQUEST_CLOSED',s.auth_user_id,s.id,'RECORD_REQUEST',p_key,'AUD-RECORD-CLOSE-'||p_key,jsonb_build_object('kind',p_kind));
 return query select response;
end $$;
revoke all on function api.record_directory(uuid,text,text,text,integer,uuid),api.change_record(uuid,uuid,text,text,uuid,jsonb,text,text),api.recover_record_operation(uuid,uuid,text) from public;
grant execute on function api.record_directory(uuid,text,text,text,integer,uuid),api.change_record(uuid,uuid,text,text,uuid,jsonb,text,text),api.recover_record_operation(uuid,uuid,text) to campuspay_runtime;

-- A sign-in can have read active=true before deactivation acquired the session
-- barrier. Recheck at the actual insertion point; an inactive student must not
-- receive a fresh session after that barrier releases.
create function private.require_active_customer_session_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
 perform set_config('lock_timeout','5s',true);
 perform pg_advisory_xact_lock(hashtextextended('campuspay-student-lifecycle:'||new.student_id::text,40404));
 perform 1 from private.students where id=new.student_id and active for share;
 if not found then raise exception 'FORBIDDEN';end if;
 return new;
end $$;
create trigger require_active_student before insert on private.customer_sessions
 for each row execute function private.require_active_customer_session_insert();
revoke all on function private.require_active_customer_session_insert() from public,campuspay_runtime;

-- Legacy wallet adjustment confirmation previously relied on the active state
-- observed at card scan. Keep the settled-receipt/recovery contract, but recheck
-- under a student lock before an unposted adjustment can affect a wallet.
alter function api.confirm_wallet_adjustment(uuid,uuid,text) set schema private;
alter function private.confirm_wallet_adjustment(uuid,uuid,text) rename to confirm_wallet_adjustment_legacy;
revoke all on function private.confirm_wallet_adjustment_legacy(uuid,uuid,text) from public,campuspay_runtime;
create function api.confirm_wallet_adjustment(p_session_id uuid,p_intent_id uuid,p_student_pin_proof text)
returns table(approved boolean,error_code text,ledger_id uuid,reference_number text,amount_won bigint,
 balance_before_won bigint,balance_after_won bigint,debt_after_won bigint,created_at timestamptz)
language plpgsql security definer set search_path = '' as $$
declare s private.staff_sessions;i private.wallet_adjustment_intents;
begin
 s:=private.assert_session(p_session_id,'wallet.adjust');
 select * into i from private.wallet_adjustment_intents where id=p_intent_id for update;
 if not found or i.staff_session_id<>s.id then raise exception 'NOT_FOUND';end if;
 if i.state<>'completed' and i.student_id is not null then
  perform set_config('lock_timeout','5s',true);
  perform pg_advisory_xact_lock(hashtextextended('campuspay-student-lifecycle:'||i.student_id::text,40404));
  perform 1 from private.students where id=i.student_id and active for share;
  if not found then raise exception 'FORBIDDEN';end if;
 end if;
 return query select * from private.confirm_wallet_adjustment_legacy(s.id,p_intent_id,p_student_pin_proof);
end $$;
revoke all on function api.confirm_wallet_adjustment(uuid,uuid,text) from public;
grant execute on function api.confirm_wallet_adjustment(uuid,uuid,text) to campuspay_runtime;
