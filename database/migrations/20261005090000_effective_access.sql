-- Stored effective access replaces runtime role bundles. Historical role enum is retained
-- only for compatibility and the intentional Super Admin access-assignment invariant.
create table private.capability_catalog (
 name text primary key, workspace text not null, area text not null, access_column text not null,
 label text not null, prerequisites text[] not null
);
insert into private.capability_catalog values
('pos.read','Register','Point of sale','View','View the register',array[]::text[]),
('pos.checkout','Register','Point of sale','Operate','Take payments',array['pos.read']::text[]),
('coupons.redeem','Register','Sale coupons','Operate','Apply a sale coupon',array['pos.checkout']::text[]),
('orders.read','Register','Online orders','View','View online orders',array[]::text[]),
('orders.fulfill','Register','Online orders','Operate','Fulfill online orders',array['orders.read']::text[]),
('cash.read','Register','Cash drawer','View','View this register’s cash records',array[]::text[]),
('cash.shift.manage','Register','Cash drawer','Operate','Open and close an assigned drawer',array['cash.read']::text[]),
('cash.drawer.override','Register','Cash drawer','Manage','Operate another employee’s drawer on this terminal',array['cash.shift.manage']::text[]),
('cash.movement.record','Register','Cash movements','Operate','Record cash paid in, paid out and drops',array['cash.read']::text[]),
('cash.movement.approve','Register','Cash movements','Approve','Independently approve cash movements',array['cash.read']::text[]),
('students.read','Students','Student accounts','View','Find and view student identity and account readiness',array[]::text[]),
('students.enroll','Students','Enrollment','Operate','Enroll a student or complete roster enrollment',array['students.read','credentials.issue']::text[]),
('students.status.manage','Students','Student accounts','Manage','Deactivate and reactivate student accounts',array['students.read']::text[]),
('credentials.read','Students','Credentials','View','View card and PIN readiness',array['students.read']::text[]),
('credentials.issue','Students','Initial credentials','Operate','Issue initial card and PIN during enrollment',array['credentials.read']::text[]),
('credentials.reset','Students','PIN reset','Manage','Reset an existing PIN with independent approval',array['credentials.read']::text[]),
('credentials.card.replace','Students','Card replacement','Manage','Replace an existing card with independent approval',array['credentials.read']::text[]),
('credentials.approve','Students','Credentials','Approve','Independently approve credential changes',array['credentials.read']::text[]),
('wallet.read','Students','Wallets','View','View student balances and wallet history',array['students.read']::text[]),
('wallet.fund','Students','Wallets','Operate','Accept a normal cash student deposit',array['wallet.read']::text[]),
('wallet.correct','Students','Wallet corrections','Manage','Initiate an independently approved wallet credit or debit',array['wallet.read']::text[]),
('wallet.reverse','Students','Funding reversals','Manage','Reverse an exact funding receipt with independent approval',array['wallet.read']::text[]),
('wallet.approve','Students','Wallet corrections','Approve','Independently approve wallet corrections and reversals',array['wallet.read']::text[]),
('inventory.read','Inventory','Products and stock','View','View products, stock and lots',array[]::text[]),
('inventory.receive','Inventory','Stock receiving','Operate','Receive stock',array['inventory.read']::text[]),
('inventory.adjust','Inventory','Stock removal','Operate','Record documented stock removal',array['inventory.read']::text[]),
('inventory.product.manage','Inventory','Products and stock','Manage','Create, edit, archive and restore products',array['inventory.read']::text[]),
('inventory.price.manage','Inventory','Product pricing','Manage','Change product prices',array['inventory.read']::text[]),
('coupons.read','Inventory','Coupons','View','View coupon definitions',array[]::text[]),
('coupons.manage','Inventory','Coupons','Manage','Create and deactivate coupons',array['coupons.read']::text[]),
('refunds.read','Finance','Refunds','View','View original sales and refund receipts',array[]::text[]),
('refunds.issue','Finance','Refunds','Operate','Issue verified refunds within installed policy',array['refunds.read']::text[]),
('refunds.cash_payout','Finance','Refund cash handover','Operate','Record an authorized refund cash handover',array['refunds.read']::text[]),
('reports.sales','Finance','Sales reports','View','View sales reports',array[]::text[]),
('reports.inventory','Finance','Inventory reports','View','View inventory reports',array[]::text[]),
('reports.wallets','Finance','Wallet reports','View','View wallet reports',array[]::text[]),
('reports.coupons','Finance','Coupon reports','View','View coupon reports',array[]::text[]),
('reconciliation.read','Finance','Reconciliation','View','Review and export daily reconciliation',array[]::text[]),
('cash.history.all','Finance','Cash history','View','View cash history across registers',array['cash.read']::text[]),
('cash.variance.review','Finance','Cash variances','Approve','Independently review cash count variances',array['cash.history.all']::text[]),
('staff.read','Admin','Staff','View','View staff profiles',array[]::text[]),
('staff.manage','Admin','Staff','Manage','Manage staff profiles, credentials and sessions',array['staff.read']::text[]),
('staff.access.manage','Admin','Employee access','Manage','Assign exact employee access; Super Admin only',array['staff.manage']::text[]),
('terminals.read','Admin','Registers','View','View registered terminals',array[]::text[]),
('terminals.manage','Admin','Registers','Manage','Rename, deactivate and revoke terminal sessions',array['terminals.read']::text[]),
('settings.payments.manage','Admin','Payment settings','Manage','Configure this register’s payment policy',array[]::text[]),
('audit.read','Admin','Access audit','View','View immutable employee access history',array['staff.read']::text[]);
create table private.access_preset_defaults (
 preset text primary key check(preset in ('staff','manager','accountant','super_admin')),
 permissions text[] not null
);
insert into private.access_preset_defaults values
('staff',array['pos.read','pos.checkout','coupons.redeem']::text[]),
('manager',array['pos.read','pos.checkout','coupons.redeem','orders.read','orders.fulfill','cash.read','cash.shift.manage','cash.movement.record','students.read','inventory.read','inventory.receive','inventory.adjust','inventory.product.manage','inventory.price.manage','coupons.read','coupons.manage','refunds.read','refunds.issue','reports.sales','reports.inventory','reports.coupons']::text[]),
('accountant',array['students.read','wallet.read','wallet.fund','cash.read','cash.shift.manage','cash.movement.record','cash.movement.approve','cash.history.all','cash.variance.review','refunds.read','reports.sales','reports.inventory','reports.wallets','reports.coupons','reconciliation.read']::text[]),
('super_admin',array['pos.read','pos.checkout','coupons.redeem','orders.read','orders.fulfill','cash.read','cash.shift.manage','cash.drawer.override','cash.movement.record','cash.movement.approve','students.read','students.enroll','students.status.manage','credentials.read','credentials.issue','credentials.reset','credentials.card.replace','credentials.approve','wallet.read','wallet.fund','wallet.correct','wallet.reverse','wallet.approve','inventory.read','inventory.receive','inventory.adjust','inventory.product.manage','inventory.price.manage','coupons.read','coupons.manage','refunds.read','refunds.issue','refunds.cash_payout','reports.sales','reports.inventory','reports.wallets','reports.coupons','reconciliation.read','cash.history.all','cash.variance.review','staff.read','staff.manage','staff.access.manage','terminals.read','terminals.manage','settings.payments.manage','audit.read']::text[]);
create function private.valid_access(p_permissions text[]) returns boolean
language sql stable security definer set search_path = '' as $$
 select p_permissions is not null and not exists(select 1 from unnest(p_permissions) n where n is null)
 and cardinality(p_permissions)=(select count(distinct n) from unnest(p_permissions) n)
 and not exists(select 1 from unnest(p_permissions) n left join private.capability_catalog c on c.name=n
 where c.name is null or not c.prerequisites <@ p_permissions);
$$;
create table private.staff_access (
 user_id uuid primary key references public.staff_profiles(auth_user_id) on delete restrict,
 preset text not null references private.access_preset_defaults(preset),
 permissions text[] not null check(private.valid_access(permissions)),
 revision bigint not null default 1 check(revision>0), updated_at timestamptz not null default clock_timestamp()
);
create function private.legacy_access(p_role public.staff_role) returns text[]
language sql immutable set search_path = '' as $$ select case p_role::text
when 'cashier' then array['pos.read','pos.checkout','coupons.redeem','orders.read','orders.fulfill','cash.read','cash.shift.manage','cash.movement.record']::text[]
when 'inventory_admin' then array['inventory.read','inventory.receive','inventory.adjust','inventory.product.manage','inventory.price.manage','coupons.read','coupons.manage','reports.inventory','orders.read','orders.fulfill','students.read','credentials.read','credentials.reset','credentials.card.replace']::text[]
when 'accountant' then array['students.read','wallet.read','wallet.fund','wallet.correct','wallet.reverse','reports.sales','reports.inventory','reports.wallets','reports.coupons','reconciliation.read','refunds.read','cash.read','cash.shift.manage','cash.movement.record','cash.movement.approve','cash.history.all','cash.variance.review','credentials.read','credentials.reset','credentials.card.replace']::text[]
when 'super_admin' then array['pos.read','pos.checkout','coupons.redeem','orders.read','orders.fulfill','cash.read','cash.shift.manage','cash.drawer.override','cash.movement.record','cash.movement.approve','students.read','students.enroll','students.status.manage','credentials.read','credentials.issue','credentials.reset','credentials.card.replace','credentials.approve','wallet.read','wallet.fund','wallet.correct','wallet.reverse','wallet.approve','inventory.read','inventory.receive','inventory.adjust','inventory.product.manage','inventory.price.manage','coupons.read','coupons.manage','refunds.read','refunds.issue','refunds.cash_payout','reports.sales','reports.inventory','reports.wallets','reports.coupons','reconciliation.read','cash.history.all','cash.variance.review','staff.read','staff.manage','staff.access.manage','terminals.read','terminals.manage','settings.payments.manage','audit.read']::text[]
else array[]::text[] end; $$;
create function private.effective_permissions(p_user_id uuid) returns text[]
language sql stable security definer set search_path = '' as $$
 select coalesce((select a.permissions from private.staff_access a join public.staff_profiles p on p.auth_user_id=a.user_id
 where a.user_id=p_user_id and p.active),array[]::text[]);
$$;
create function private.has_capability(p_user_id uuid,p_capability text) returns boolean
language sql stable security definer set search_path = '' as $$
 select p_capability=any(private.effective_permissions(p_user_id));
$$;
create function private.seed_staff_access() returns trigger
language plpgsql security definer set search_path = '' as $$ begin
 insert into private.staff_access(user_id,preset,permissions)
 values(new.auth_user_id,case new.role when 'cashier' then 'staff' when 'inventory_admin' then 'manager' else new.role::text end,private.legacy_access(new.role));
 return new;
end $$;
insert into private.staff_access(user_id,preset,permissions)
select auth_user_id,case role when 'cashier' then 'staff' when 'inventory_admin' then 'manager' else role::text end,private.legacy_access(role)
from public.staff_profiles;
create trigger seed_effective_access after insert on public.staff_profiles for each row execute function private.seed_staff_access();
-- Every migrated identity retains a reviewable translation; no wallet, stock or credential changes.
insert into private.audit_events(event_type,subject_type,subject_id,reference_number,safe_payload)
select 'STAFF_ACCESS_MIGRATED','STAFF',p.auth_user_id,'AUD-ACCESS-MIGRATION-'||p.auth_user_id,
 jsonb_build_object('previous_role',p.role,'previous_permissions',private.permissions_for_role(p.role),
 'new_preset',a.preset,'effective_permissions',a.permissions,'reason','Explicit equivalent legacy capabilities; legacy unclassified wallet adjustment retired')
from public.staff_profiles p join private.staff_access a on a.user_id=p.auth_user_id;
alter table private.staff_sessions add column access_revision bigint not null default 0;
-- Sign in again after migration; no old session can survive a changed access snapshot.
update private.staff_sessions set revoked_at=clock_timestamp() where revoked_at is null;
revoke all on private.capability_catalog,private.access_preset_defaults,private.staff_access from public,campuspay_runtime;
revoke all on function private.valid_access(text[]),private.legacy_access(public.staff_role),private.effective_permissions(uuid),
 private.has_capability(uuid,text),private.seed_staff_access() from public,campuspay_runtime;

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

  if v_session.access_revision is distinct from (select a.revision from private.staff_access a where a.user_id=v_profile.auth_user_id) then raise exception 'SESSION_EXPIRED'; end if;
  if p_permission is not null and not private.has_capability(v_profile.auth_user_id, p_permission) then
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
create or replace function private.assert_session_any(p_session_id uuid,p_permissions text[]) returns private.staff_sessions
language plpgsql security definer set search_path = '' as $$
declare s private.staff_sessions; n text; begin
 s:=private.assert_session(p_session_id,null);
 foreach n in array p_permissions loop if private.has_capability(s.auth_user_id,n) then return s; end if; end loop;
 raise exception 'FORBIDDEN'; end $$;
-- Old permission names are never aliased to broader new authority.
-- Existing implementations retain their lock ordering; alter only resolution and snapshot storage.
do $$ declare definition text; begin
 definition:=pg_get_functiondef('api.create_staff_session(text,text,text,text)'::regprocedure);
 if position('private.permissions_for_role(v_profile.role)' in definition)=0 then raise exception 'ACCESS_LOGIN_PRECONDITION';end if;
 definition:=replace(definition,'private.permissions_for_role(v_profile.role)','private.effective_permissions(v_profile.auth_user_id)');
 definition:=replace(definition,'session_token_hash, expires_at','session_token_hash, access_revision, expires_at');
 definition:=replace(definition,'p_session_token_hash, now() + private.session_timeout(v_profile.role)',
 'p_session_token_hash, (select a.revision from private.staff_access a where a.user_id=v_profile.auth_user_id), now() + private.session_timeout(v_profile.role)');
 execute definition;
 definition:=pg_get_functiondef('api.authorize_session(text,text,text)'::regprocedure);
 if position('private.permissions_for_role(v_profile.role)' in definition)=0 then raise exception 'ACCESS_AUTHORIZE_PRECONDITION';end if;
 execute replace(definition,'private.permissions_for_role(v_profile.role)','private.effective_permissions(v_profile.auth_user_id)');
end $$;

alter function api.create_staff_session(text,text,text,text) set schema private;
alter function private.create_staff_session(text,text,text,text) rename to create_staff_session_access_legacy;
revoke all on function private.create_staff_session_access_legacy(text,text,text,text) from public,campuspay_runtime;
create function api.create_staff_session(p_employee_code text,p_pin_proof text,p_session_token_hash text,p_terminal_fingerprint text)
returns table(session_id uuid,user_id uuid,employee_code text,display_name text,role public.staff_role,permissions text[],expires_at timestamptz,preset text,access_revision bigint)
language sql security definer set search_path = '' as $$
 select s.*,a.preset,a.revision from private.create_staff_session_access_legacy(p_employee_code,p_pin_proof,p_session_token_hash,p_terminal_fingerprint) s join private.staff_access a on a.user_id=s.user_id;
$$;
revoke all on function api.create_staff_session(text,text,text,text) from public;
grant execute on function api.create_staff_session(text,text,text,text) to campuspay_runtime;

alter function api.authorize_session(text,text,text) set schema private;
alter function private.authorize_session(text,text,text) rename to authorize_session_access_legacy;
revoke all on function private.authorize_session_access_legacy(text,text,text) from public,campuspay_runtime;
create function api.authorize_session(p_session_token_hash text,p_terminal_fingerprint text,p_permission text default null)
returns table(session_id uuid,user_id uuid,employee_code text,display_name text,role public.staff_role,permissions text[],expires_at timestamptz,preset text,access_revision bigint)
language sql security definer set search_path = '' as $$
 select s.*,a.preset,a.revision from private.authorize_session_access_legacy(p_session_token_hash,p_terminal_fingerprint,p_permission) s join private.staff_access a on a.user_id=s.user_id;
$$;
revoke all on function api.authorize_session(text,text,text) from public;
grant execute on function api.authorize_session(text,text,text) to campuspay_runtime;

insert into private.schema_migrations(version) values('20261005090000_effective_access') on conflict do nothing;
