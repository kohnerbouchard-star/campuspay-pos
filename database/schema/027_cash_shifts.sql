-- Drawer control is separate from event permission to accept cash. Default-off for reviewed activation.
alter table private.system_settings add column cash_controls_enabled boolean not null default false;
create table private.cash_shifts (
 id uuid primary key default gen_random_uuid(),
 terminal_id uuid not null references private.terminals(id) on delete restrict,
 opened_by uuid not null references public.staff_profiles(auth_user_id) on delete restrict,
 opening_key uuid not null unique,
 opening_denominations jsonb not null,
 opening_float_won bigint not null check(opening_float_won between 0 and 1000000000),
 opened_at timestamptz not null default clock_timestamp(),
 closed_at timestamptz
);
create unique index cash_one_open_shift on private.cash_shifts(terminal_id) where closed_at is null;
create table private.cash_shift_events (
 id uuid primary key default gen_random_uuid(), shift_id uuid not null references private.cash_shifts(id) on delete restrict,
 source_type text not null check(source_type in ('SALE_TENDER','REFUND_PAYOUT')),
 source_id uuid not null, amount_won bigint not null,
 created_at timestamptz not null default clock_timestamp(), unique(source_type,source_id),
 check((source_type='SALE_TENDER' and amount_won>=0) or (source_type='REFUND_PAYOUT' and amount_won<0))
);
create table private.cash_shift_closes (
 shift_id uuid primary key references private.cash_shifts(id) on delete restrict,
 request_key uuid not null unique, closed_by uuid not null references public.staff_profiles(auth_user_id) on delete restrict,
 denominations jsonb not null, counted_won bigint not null check(counted_won between 0 and 1000000000),
 expected_won bigint not null, variance_won bigint not null,
 notes text not null check(length(btrim(notes)) between 10 and 500),
 created_at timestamptz not null default clock_timestamp(), check(variance_won=counted_won-expected_won)
);
create table private.cash_shift_approvals (
 shift_id uuid primary key references private.cash_shift_closes(shift_id) on delete restrict,
 approved_by uuid not null references public.staff_profiles(auth_user_id) on delete restrict,
 notes text not null check(length(btrim(notes)) between 10 and 500), created_at timestamptz not null default clock_timestamp()
);
create table private.cash_operation_closures (
 request_key uuid primary key, actor_id uuid not null references public.staff_profiles(auth_user_id) on delete restrict,
 operation text not null check(operation in ('OPEN','CLOSE')), shift_id uuid references private.cash_shifts(id) on delete restrict,
 created_at timestamptz not null default now()
);
create index cash_events_shift_idx on private.cash_shift_events(shift_id);
create index cash_closes_created_idx on private.cash_shift_closes(created_at,shift_id);
do $$ declare n text; begin
 foreach n in array array['cash_shift_events','cash_shift_closes','cash_shift_approvals','cash_operation_closures'] loop
  execute format('create trigger immutable_journal before update or delete on private.%I for each row execute function private.reject_journal_mutation()',n);
 end loop;
end $$;
revoke all on private.cash_shifts,private.cash_shift_events,private.cash_shift_closes,private.cash_shift_approvals,private.cash_operation_closures from public,campuspay_runtime;

create function private.cash_denominations_total(p_counts jsonb) returns bigint
language plpgsql immutable set search_path = '' as $$
declare k text; v jsonb; total bigint:=0;
begin
 if jsonb_typeof(p_counts) is distinct from 'object' or p_counts='{}'::jsonb then raise exception 'BAD_REQUEST'; end if;
 for k,v in select * from jsonb_each(p_counts) loop
  if k not in ('50000','10000','5000','1000','500','100','50','10') or jsonb_typeof(v)<>'number'
   or v::text !~ '^[0-9]{1,6}$' then raise exception 'BAD_REQUEST'; end if;
  total:=total+k::bigint*(v::text)::bigint;
 end loop;
 if total>1000000000 then raise exception 'BAD_REQUEST'; end if;
 return total;
end $$;
create function private.cash_session(p_session_id uuid) returns private.staff_sessions
language plpgsql security definer set search_path = '' as $$
declare s private.staff_sessions;
begin
 s:=private.assert_session(p_session_id,case when (select role_snapshot from private.staff_sessions where id=p_session_id)='accountant' then 'reports.sales' else 'pos.checkout' end);
 return s;
end $$;
create function private.cash_shift_document(p_id uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
 select jsonb_build_object('shift_id',s.id,'terminal_id',s.terminal_id,'terminal_label',t.label,'opened_by',s.opened_by,'opened_at',s.opened_at,'closed_at',s.closed_at,
 'opening_float_won',s.opening_float_won,'cash_sales_won',coalesce((select sum(amount_won) from private.cash_shift_events e where e.shift_id=s.id and source_type='SALE_TENDER'),0),
 'cash_payouts_won',-coalesce((select sum(amount_won) from private.cash_shift_events e where e.shift_id=s.id and source_type='REFUND_PAYOUT'),0),
 'expected_won',coalesce(c.expected_won,s.opening_float_won+coalesce((select sum(amount_won) from private.cash_shift_events e where e.shift_id=s.id),0)),
 'counted_won',c.counted_won,'variance_won',c.variance_won,'close_notes',c.notes,'closed_by',c.closed_by,
 'approved_by',a.approved_by,'approval_notes',a.notes,'review_required',coalesce(c.variance_won<>0 and a.shift_id is null,false))
 from private.cash_shifts s join private.terminals t on t.id=s.terminal_id
 left join private.cash_shift_closes c on c.shift_id=s.id left join private.cash_shift_approvals a on a.shift_id=s.id where s.id=p_id;
$$;
create function api.cash_register_snapshot(p_session_id uuid,p_offset integer default 0) returns table(result jsonb)
language plpgsql security definer set search_path = '' as $$
declare s private.staff_sessions;
begin
 s:=private.cash_session(p_session_id);
 if p_offset is null or p_offset<0 or p_offset>1000000 then raise exception 'BAD_REQUEST'; end if;
 return query select jsonb_build_object('enabled',(select cash_controls_enabled from private.system_settings where singleton),
 'terminal_id',s.terminal_id,'current_shift',(select private.cash_shift_document(id) from private.cash_shifts where terminal_id=s.terminal_id and closed_at is null),
 'closed_shifts',coalesce((select jsonb_agg(private.cash_shift_document(x.id) order by x.closed_at desc,x.id) from
  (select id,closed_at from private.cash_shifts where closed_at is not null and (s.role_snapshot in ('super_admin','accountant') or terminal_id=s.terminal_id) order by closed_at desc,id limit 50 offset p_offset) x),'[]'::jsonb),
 'total_closed',(select count(*) from private.cash_shifts where closed_at is not null and (s.role_snapshot in ('super_admin','accountant') or terminal_id=s.terminal_id)));
end $$;
create function api.open_cash_shift(p_session_id uuid,p_key uuid,p_counts jsonb,p_verified boolean) returns table(result jsonb)
language plpgsql security definer set search_path = '' as $$
declare s private.staff_sessions; sh private.cash_shifts; total bigint;
begin
 s:=private.cash_session(p_session_id);
 if s.role_snapshot='accountant' then raise exception 'FORBIDDEN'; end if;
 if p_key is null or p_verified is distinct from true then raise exception 'BAD_REQUEST'; end if;
 total:=private.cash_denominations_total(p_counts);
 perform pg_advisory_xact_lock(hashtextextended('cash-operation:'||p_key::text,0));
 select * into sh from private.cash_shifts where opening_key=p_key;
 if found then
  if sh.terminal_id<>s.terminal_id or sh.opened_by<>s.auth_user_id or sh.opening_denominations<>p_counts then raise exception 'CONFLICT'; end if;
  return query select private.cash_shift_document(sh.id); return;
 end if;
 if exists(select 1 from private.cash_operation_closures where request_key=p_key) or exists(select 1 from private.cash_shift_closes where request_key=p_key) then raise exception 'CONFLICT'; end if;
 perform 1 from private.system_settings where singleton for share;
 if not (select cash_controls_enabled from private.system_settings where singleton) then raise exception 'CASH_CONTROLS_DISABLED'; end if;
 perform 1 from private.terminals where id=s.terminal_id for no key update;
 if exists(select 1 from private.cash_shifts where terminal_id=s.terminal_id and closed_at is null) then raise exception 'CONFLICT'; end if;
 insert into private.cash_shifts(terminal_id,opened_by,opening_key,opening_denominations,opening_float_won)
 values(s.terminal_id,s.auth_user_id,p_key,p_counts,total) returning * into sh;
 insert into private.audit_events(event_type,actor_user_id,staff_session_id,subject_type,subject_id,reference_number,safe_payload)
 values('CASH_SHIFT_OPENED',s.auth_user_id,s.id,'CASH_SHIFT',sh.id,'AUD-CASH-OPEN-'||sh.id,jsonb_build_object('opening_float_won',total,'terminal_id',s.terminal_id));
 return query select private.cash_shift_document(sh.id);
end $$;
create function api.close_cash_shift(p_session_id uuid,p_shift_id uuid,p_key uuid,p_counts jsonb,p_notes text,p_verified boolean) returns table(result jsonb)
language plpgsql security definer set search_path = '' as $$
declare s private.staff_sessions; sh private.cash_shifts; c private.cash_shift_closes; total bigint; expected bigint; finished timestamptz;
begin
 s:=private.cash_session(p_session_id);
 if s.role_snapshot='accountant' then raise exception 'FORBIDDEN'; end if;
 if p_shift_id is null or p_key is null or p_verified is distinct from true or p_notes is null or length(btrim(p_notes)) not between 10 and 500 or p_notes ~ '[[:cntrl:]]' then raise exception 'BAD_REQUEST'; end if;
 total:=private.cash_denominations_total(p_counts);
 perform pg_advisory_xact_lock(hashtextextended('cash-operation:'||p_key::text,0));
 select * into c from private.cash_shift_closes where request_key=p_key;
 if found then
  if c.shift_id<>p_shift_id or c.closed_by<>s.auth_user_id or c.denominations<>p_counts or c.notes<>btrim(p_notes) then raise exception 'CONFLICT'; end if;
  if (select terminal_id from private.cash_shifts where id=c.shift_id)<>s.terminal_id then raise exception 'FORBIDDEN'; end if;
  return query select private.cash_shift_document(p_shift_id); return;
 end if;
 if exists(select 1 from private.cash_operation_closures where request_key=p_key) or exists(select 1 from private.cash_shifts where opening_key=p_key) then raise exception 'CONFLICT'; end if;
 select * into sh from private.cash_shifts where id=p_shift_id for update;
 if not found then raise exception 'NOT_FOUND'; end if;
 if sh.terminal_id<>s.terminal_id or (sh.opened_by<>s.auth_user_id and s.role_snapshot<>'super_admin') then raise exception 'FORBIDDEN'; end if;
 if sh.closed_at is not null then raise exception 'CONFLICT'; end if;
 expected:=sh.opening_float_won+coalesce((select sum(amount_won) from private.cash_shift_events where shift_id=sh.id),0);
 finished:=clock_timestamp();
 insert into private.cash_shift_closes(shift_id,request_key,closed_by,denominations,counted_won,expected_won,variance_won,notes,created_at)
 values(sh.id,p_key,s.auth_user_id,p_counts,total,expected,total-expected,btrim(p_notes),finished);
 update private.cash_shifts set closed_at=finished where id=sh.id;
 insert into private.audit_events(event_type,actor_user_id,staff_session_id,subject_type,subject_id,reference_number,safe_payload)
 values('CASH_SHIFT_CLOSED',s.auth_user_id,s.id,'CASH_SHIFT',sh.id,'AUD-CASH-CLOSE-'||sh.id,jsonb_build_object('expected_won',expected,'counted_won',total,'variance_won',total-expected));
 return query select private.cash_shift_document(sh.id);
end $$;
create function api.recover_cash_operation(p_session_id uuid,p_key uuid,p_operation text,p_shift_id uuid) returns table(result jsonb)
language plpgsql security definer set search_path = '' as $$
declare s private.staff_sessions; sh private.cash_shifts; c private.cash_shift_closes; fence private.cash_operation_closures;
begin
 s:=private.cash_session(p_session_id);
 if s.role_snapshot='accountant' then raise exception 'FORBIDDEN'; end if;
 if p_key is null or p_operation not in ('OPEN','CLOSE') or p_operation is null or (p_operation='CLOSE' and p_shift_id is null) or (p_operation='OPEN' and p_shift_id is not null) then raise exception 'BAD_REQUEST'; end if;
 perform pg_advisory_xact_lock(hashtextextended('cash-operation:'||p_key::text,0));
 select * into sh from private.cash_shifts where opening_key=p_key;
 select * into c from private.cash_shift_closes where request_key=p_key;
 if sh.id is not null then
  if p_operation<>'OPEN' or sh.opened_by<>s.auth_user_id or sh.terminal_id<>s.terminal_id then raise exception 'FORBIDDEN'; end if;
  return query select jsonb_build_object('outcome','COMPLETED','shift',private.cash_shift_document(sh.id)); return;
 elsif c.shift_id is not null then
  if p_operation<>'CLOSE' or c.shift_id<>p_shift_id or c.closed_by<>s.auth_user_id or (select terminal_id from private.cash_shifts where id=c.shift_id)<>s.terminal_id then raise exception 'FORBIDDEN'; end if;
  return query select jsonb_build_object('outcome','COMPLETED','shift',private.cash_shift_document(c.shift_id)); return;
 end if;
 if p_shift_id is not null and not exists(select 1 from private.cash_shifts where id=p_shift_id and terminal_id=s.terminal_id and (opened_by=s.auth_user_id or s.role_snapshot='super_admin')) then raise exception 'FORBIDDEN'; end if;
 select * into fence from private.cash_operation_closures where request_key=p_key;
 if found and (fence.actor_id<>s.auth_user_id or fence.operation<>p_operation or fence.shift_id is distinct from p_shift_id) then raise exception 'FORBIDDEN'; end if;
 insert into private.cash_operation_closures(request_key,actor_id,operation,shift_id) values(p_key,s.auth_user_id,p_operation,p_shift_id) on conflict do nothing;
 return query select jsonb_build_object('outcome','CLOSED','shift',null);
end $$;
create function api.approve_cash_variance(p_session_id uuid,p_shift_id uuid,p_notes text) returns table(result jsonb)
language plpgsql security definer set search_path = '' as $$
declare s private.staff_sessions; c private.cash_shift_closes; a private.cash_shift_approvals;
begin
 s:=private.assert_session(p_session_id,'reports.sales');
 if s.role_snapshot not in ('accountant','super_admin') then raise exception 'FORBIDDEN'; end if;
 if p_notes is null or length(btrim(p_notes)) not between 10 and 500 or p_notes ~ '[[:cntrl:]]' then raise exception 'BAD_REQUEST'; end if;
 perform pg_advisory_xact_lock(hashtextextended('cash-review:'||p_shift_id::text,0));
 select * into c from private.cash_shift_closes where shift_id=p_shift_id;
 if not found then raise exception 'NOT_FOUND'; end if;
 if c.closed_by=s.auth_user_id then raise exception 'FORBIDDEN'; end if;
 select * into a from private.cash_shift_approvals where shift_id=p_shift_id;
 if found then
  if a.approved_by<>s.auth_user_id or a.notes<>btrim(p_notes) then raise exception 'CONFLICT'; end if;
 else
  insert into private.cash_shift_approvals(shift_id,approved_by,notes) values(p_shift_id,s.auth_user_id,btrim(p_notes));
  insert into private.audit_events(event_type,actor_user_id,staff_session_id,subject_type,subject_id,reference_number,safe_payload)
  values('CASH_VARIANCE_REVIEWED',s.auth_user_id,s.id,'CASH_SHIFT',p_shift_id,'AUD-CASH-REVIEW-'||p_shift_id,jsonb_build_object('variance_won',c.variance_won));
 end if;
 return query select private.cash_shift_document(p_shift_id);
end $$;

-- Cash is attributed in the SAME transaction as settlement/handover. Change is already excluded.
create function private.capture_cash_shift_event() returns trigger
language plpgsql security definer set search_path = '' as $$
declare term uuid; sh private.cash_shifts; amount bigint; kind text;
begin
 if tg_table_name='sale_tenders' then
  if new.tender_type<>'CASH' then return new; end if;
  term:=new.terminal_id;
  amount:=new.settled_amount_won; kind:='SALE_TENDER';
 else term:=new.terminal_id; amount:=-new.amount_won; kind:='REFUND_PAYOUT'; end if;
 perform 1 from private.system_settings where singleton for share;
 if not (select cash_controls_enabled from private.system_settings where singleton) then return new; end if;
 select * into sh from private.cash_shifts where terminal_id=term and closed_at is null for update;
 if not found then raise exception 'CASH_SHIFT_REQUIRED'; end if;
 insert into private.cash_shift_events(shift_id,source_type,source_id,amount_won) values(sh.id,kind,new.id,amount);
 return new;
end $$;
create trigger capture_cash before insert on private.sale_tenders for each row execute function private.capture_cash_shift_event();
create trigger capture_cash before insert on private.cash_refund_payouts for each row execute function private.capture_cash_shift_event();
-- Each attributed amount must reference the actual committed payment, not an invented cash event.
create function private.verify_cash_event() returns trigger
language plpgsql security definer set search_path = '' as $$
declare term uuid; value bigint;
begin
 if new.source_type='SALE_TENDER' then
  select terminal_id,settled_amount_won into term,value from private.sale_tenders where id=new.source_id and tender_type='CASH';
 else
  select terminal_id,-amount_won into term,value from private.cash_refund_payouts where id=new.source_id;
 end if;
 if term is null or value is distinct from new.amount_won or not exists(select 1 from private.cash_shifts where id=new.shift_id and terminal_id=term) then raise exception 'CASH_EVENT_INTEGRITY'; end if;
 return null;
end $$;
create constraint trigger cash_event_reconciles after insert on private.cash_shift_events deferrable initially deferred
for each row execute function private.verify_cash_event();
create function private.guard_cash_shift() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
 if tg_op='DELETE' or old.closed_at is not null or new.closed_at is null or (to_jsonb(new)-'closed_at')<>(to_jsonb(old)-'closed_at') then raise exception 'IMMUTABLE_CASH_SHIFT'; end if;
 if not exists(select 1 from private.cash_shift_closes where shift_id=old.id and created_at=new.closed_at) then raise exception 'CASH_CLOSE_REQUIRED'; end if;
 return new;
end $$;
create trigger cash_shift_guard before update or delete on private.cash_shifts for each row execute function private.guard_cash_shift();
revoke all on function private.verify_cash_event(),private.guard_cash_shift() from public,campuspay_runtime;

-- Never disable attribution while a drawer is open; protect expected cash from a mid-shift setting change.
create function private.guard_cash_control_setting() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
 if old.cash_controls_enabled is distinct from new.cash_controls_enabled and exists(select 1 from private.cash_shifts where closed_at is null) then raise exception 'CONFLICT'; end if;
 return new;
end $$;
create trigger cash_control_change before update on private.system_settings for each row execute function private.guard_cash_control_setting();
revoke all on function private.cash_denominations_total(jsonb),private.cash_session(uuid),private.cash_shift_document(uuid),private.capture_cash_shift_event(),private.guard_cash_control_setting() from public,campuspay_runtime;
revoke all on function api.cash_register_snapshot(uuid,integer),api.open_cash_shift(uuid,uuid,jsonb,boolean),api.close_cash_shift(uuid,uuid,uuid,jsonb,text,boolean),api.recover_cash_operation(uuid,uuid,text,uuid),api.approve_cash_variance(uuid,uuid,text) from public;
grant execute on function api.cash_register_snapshot(uuid,integer),api.open_cash_shift(uuid,uuid,jsonb,boolean),api.close_cash_shift(uuid,uuid,uuid,jsonb,text,boolean),api.recover_cash_operation(uuid,uuid,text,uuid),api.approve_cash_variance(uuid,uuid,text) to campuspay_runtime;
insert into private.schema_migrations(version) values('20260918180000_cash_shifts') on conflict do nothing;
