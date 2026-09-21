-- Explicit funding and physical cash records. No seed, activation or live data change.
alter table private.system_settings
 add column funding_enabled boolean not null default false,
 add column funding_required boolean not null default false;
create function private.guard_funding_settings() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
 if old.funding_required and not new.funding_required then raise exception 'FUNDING_WORKFLOW_REQUIRED'; end if;
 if new.funding_enabled then new.funding_required:=true; end if;
 return new;
end $$;
create trigger funding_settings_guard before update on private.system_settings
 for each row execute function private.guard_funding_settings();

create table private.funding_intents (
 request_key uuid primary key, actor_id uuid not null references public.staff_profiles(auth_user_id),
 terminal_id uuid not null references private.terminals(id), action text not null
 check(action in ('CASH_DEPOSIT','NONCASH_CREDIT','ADMIN_DEBIT','REVERSE_FUNDING','PAID_IN','PAID_OUT','CASH_DROP')),
 request_proof text not null, wallet_delta_won bigint not null, cash_delta_won bigint not null,
 cash_received_won bigint not null default 0, change_won bigint not null default 0,
 shift_id uuid references private.cash_shifts(id), student_id uuid references private.students(id),
 card_id uuid references private.student_cards(id), original_id uuid,
 source_reference text not null check(length(source_reference) between 3 and 120),
 notes text not null check(length(notes) between 10 and 500),
 state text not null default 'PREPARED' check(state in ('PREPARED','SCANNED','COMPLETED','CLOSED')),
 pin_attempts integer not null default 0 check(pin_attempts between 0 and 3),
 created_at timestamptz not null default clock_timestamp(), expires_at timestamptz not null,
 check(wallet_delta_won<>0 or cash_delta_won<>0),
 check((cash_delta_won=0)=(shift_id is null)),
 check(cash_received_won>=0 and change_won>=0)
);
create table private.funding_operations (
 id uuid primary key, request_key uuid not null unique references private.funding_intents(request_key),
 reference_number text not null unique, action text not null,
 actor_id uuid not null references public.staff_profiles(auth_user_id),
 staff_session_id uuid not null references private.staff_sessions(id),
 terminal_id uuid not null references private.terminals(id),
 shift_id uuid references private.cash_shifts(id), student_id uuid references private.students(id),
 wallet_delta_won bigint not null, cash_delta_won bigint not null,
 cash_received_won bigint not null, change_won bigint not null,
 ledger_id uuid unique references private.wallet_ledger(id),
 balance_before_won bigint, balance_after_won bigint,
 approved_by uuid references public.staff_profiles(auth_user_id),
 original_id uuid unique references private.funding_operations(id),
 source_reference text not null, notes text not null,
 created_at timestamptz not null default clock_timestamp(),
 check((wallet_delta_won=0)=(ledger_id is null)),
 check((wallet_delta_won=0)=(student_id is null)),
 check((cash_delta_won=0)=(shift_id is null)),
 check(approved_by is null or approved_by<>actor_id),
 check(wallet_delta_won=0 or balance_after_won=balance_before_won+wallet_delta_won)
);
alter table private.funding_intents add constraint funding_original_fk
 foreign key(original_id) references private.funding_operations(id);
create table private.funding_closures (
 request_key uuid primary key, actor_id uuid not null references public.staff_profiles(auth_user_id),
 terminal_id uuid not null references private.terminals(id), created_at timestamptz not null default clock_timestamp()
);
create index funding_operations_date_idx on private.funding_operations(created_at desc,id desc);
create index funding_operations_student_idx on private.funding_operations(student_id,created_at desc);
create index funding_operations_shift_idx on private.funding_operations(shift_id);
create trigger immutable_journal before update or delete on private.funding_operations
 for each row execute function private.reject_journal_mutation();
create trigger immutable_journal before update or delete on private.funding_closures
 for each row execute function private.reject_journal_mutation();
revoke all on private.funding_intents,private.funding_operations,private.funding_closures from public,campuspay_runtime;

-- Preserve prior events; add a typed, independently reconciled source.
alter table private.cash_shift_events drop constraint cash_shift_events_source_type_check;
alter table private.cash_shift_events drop constraint cash_shift_events_check;
alter table private.cash_shift_events add constraint cash_shift_events_source_type_check
 check(source_type in ('SALE_TENDER','REFUND_PAYOUT','FUNDING_OPERATION'));
alter table private.cash_shift_events add constraint cash_shift_events_check
 check((source_type='SALE_TENDER' and amount_won>=0) or (source_type='REFUND_PAYOUT' and amount_won<0)
 or (source_type='FUNDING_OPERATION' and amount_won<>0));
create or replace function private.verify_cash_event() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_terminal uuid; v_amount bigint; v_shift uuid;
begin
 if new.source_type='SALE_TENDER' then
  select t.terminal_id,t.settled_amount_won into v_terminal,v_amount from private.sale_tenders t where t.id=new.source_id and t.tender_type='CASH';
 elsif new.source_type='REFUND_PAYOUT' then
  select p.terminal_id,-p.amount_won into v_terminal,v_amount from private.cash_refund_payouts p where p.id=new.source_id;
 else
  select o.terminal_id,o.cash_delta_won,o.shift_id into v_terminal,v_amount,v_shift from private.funding_operations o where o.id=new.source_id;
  if v_shift is distinct from new.shift_id then raise exception 'CASH_EVENT_INTEGRITY'; end if;
 end if;
 if v_terminal is null or v_amount is distinct from new.amount_won or not exists(select 1 from private.cash_shifts sh where sh.id=new.shift_id and sh.terminal_id=v_terminal) then
  raise exception 'CASH_EVENT_INTEGRITY';
 end if;
 return null;
end $$;
create function private.verify_funding_operation() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_intent private.funding_intents; v_original private.funding_operations;
begin
 select i.* into v_intent from private.funding_intents i where i.request_key=new.request_key;
 if v_intent.state<>'COMPLETED' or v_intent.actor_id<>new.actor_id or v_intent.terminal_id<>new.terminal_id
  or v_intent.action<>new.action or v_intent.wallet_delta_won<>new.wallet_delta_won
  or v_intent.cash_delta_won<>new.cash_delta_won or v_intent.shift_id is distinct from new.shift_id
  or v_intent.student_id is distinct from new.student_id or v_intent.original_id is distinct from new.original_id
  or v_intent.cash_received_won<>new.cash_received_won or v_intent.change_won<>new.change_won
  or v_intent.source_reference<>new.source_reference or v_intent.notes<>new.notes then raise exception 'FUNDING_INTEGRITY'; end if;
 if new.action<>'CASH_DEPOSIT' and new.approved_by is null then raise exception 'FUNDING_INTEGRITY'; end if;
 if new.wallet_delta_won<>0 and not exists(select 1 from private.wallet_ledger l where l.id=new.ledger_id
  and l.source_type='FUNDING_OPERATION' and l.source_id=new.id and l.idempotency_key=new.request_key
  and l.student_id=new.student_id and l.amount_won=new.wallet_delta_won and l.balance_before_won=new.balance_before_won
  and l.balance_after_won=new.balance_after_won and l.staff_user_id=new.actor_id and l.staff_session_id=new.staff_session_id) then raise exception 'FUNDING_INTEGRITY'; end if;
 if new.cash_delta_won<>0 and not exists(select 1 from private.cash_shift_events e where e.source_type='FUNDING_OPERATION'
  and e.source_id=new.id and e.shift_id=new.shift_id and e.amount_won=new.cash_delta_won) then raise exception 'FUNDING_INTEGRITY'; end if;
 if new.action='CASH_DEPOSIT' and (new.wallet_delta_won<=0 or new.cash_delta_won<>new.wallet_delta_won or new.cash_received_won-new.change_won<>new.cash_delta_won) then raise exception 'FUNDING_INTEGRITY'; end if;
 if new.action='REVERSE_FUNDING' then
  select o.* into v_original from private.funding_operations o where o.id=new.original_id;
  if v_original.id is null or v_original.action not in ('CASH_DEPOSIT','NONCASH_CREDIT','ADMIN_DEBIT')
   or new.wallet_delta_won<>-v_original.wallet_delta_won or new.cash_delta_won<>-v_original.cash_delta_won
   or new.student_id<>v_original.student_id then raise exception 'FUNDING_INTEGRITY'; end if;
 elsif new.original_id is not null then raise exception 'FUNDING_INTEGRITY'; end if;
 return null;
end $$;
create constraint trigger funding_reconciles after insert on private.funding_operations
 deferrable initially deferred for each row execute function private.verify_funding_operation();

-- Once the controlled workflow is adopted, disabling its posting switch must
-- not reopen the old unclassified adjustment route. Old receipts still recover.
create function private.guard_legacy_wallet_adjustment() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
 if new.source_type='WALLET_ADJUSTMENT' and (select funding_required from private.system_settings where singleton) then
  raise exception 'FUNDING_WORKFLOW_REQUIRED';
 end if;
 return new;
end $$;
create trigger funding_wallet_guard before insert on private.wallet_ledger
 for each row execute function private.guard_legacy_wallet_adjustment();

-- Funding accountants need their own drawer, without receiving checkout rights.
-- Closing/recovery stay possible during a funding-posting shutdown.
do $$
declare v_name text; v_definition text; v_anchor text := 'if s.role_snapshot=''accountant'' then raise exception ''FORBIDDEN''; end if;'; v_setting text;
begin
 foreach v_name in array array['api.open_cash_shift(uuid,uuid,jsonb,boolean)','api.close_cash_shift(uuid,uuid,uuid,jsonb,text,boolean)','api.recover_cash_operation(uuid,uuid,text,uuid)'] loop
  v_definition:=pg_get_functiondef(v_name::regprocedure);
  if (length(v_definition)-length(replace(v_definition,v_anchor,'')))/length(v_anchor)<>1 then raise exception 'FUNDING_CASH_PATCH_PRECONDITION'; end if;
  v_setting:=case when v_name like 'api.open_%' then 'funding_enabled' else 'funding_required' end;
  execute replace(v_definition,v_anchor,'if s.role_snapshot=''accountant'' and not (select '||v_setting||' from private.system_settings where singleton) then raise exception ''FORBIDDEN''; end if;');
 end loop;
end $$;
create or replace function private.cash_shift_document(p_id uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
 select jsonb_build_object('shift_id',sh.id,'terminal_id',sh.terminal_id,'terminal_label',t.label,'opened_by',sh.opened_by,'opened_at',sh.opened_at,'closed_at',sh.closed_at,
 'opening_float_won',sh.opening_float_won,
 'cash_sales_won',coalesce((select sum(e.amount_won) from private.cash_shift_events e where e.shift_id=sh.id and e.source_type='SALE_TENDER'),0),
 'cash_payouts_won',-coalesce((select sum(e.amount_won) from private.cash_shift_events e where e.shift_id=sh.id and e.source_type='REFUND_PAYOUT'),0),
 'funding_in_won',coalesce((select sum(e.amount_won) from private.cash_shift_events e where e.shift_id=sh.id and e.source_type='FUNDING_OPERATION' and e.amount_won>0),0),
 'funding_out_won',-coalesce((select sum(e.amount_won) from private.cash_shift_events e where e.shift_id=sh.id and e.source_type='FUNDING_OPERATION' and e.amount_won<0),0),
 'expected_won',coalesce(c.expected_won,sh.opening_float_won+coalesce((select sum(e.amount_won) from private.cash_shift_events e where e.shift_id=sh.id),0)),
 'counted_won',c.counted_won,'variance_won',c.variance_won,'close_notes',c.notes,'closed_by',c.closed_by,
 'approved_by',a.approved_by,'approval_notes',a.notes,'review_required',coalesce(c.variance_won<>0 and a.shift_id is null,false))
 from private.cash_shifts sh join private.terminals t on t.id=sh.terminal_id
 left join private.cash_shift_closes c on c.shift_id=sh.id left join private.cash_shift_approvals a on a.shift_id=sh.id where sh.id=p_id;
$$;
do $$ declare v_definition text; v_anchor text := '''terminal_id'',s.terminal_id,''current_shift'''; begin
 v_definition:=pg_get_functiondef('api.cash_register_snapshot(uuid,integer)'::regprocedure);
 if strpos(v_definition,v_anchor)=0 then raise exception 'FUNDING_SNAPSHOT_PATCH_PRECONDITION'; end if;
 execute replace(v_definition,v_anchor,'''accountant_cash_enabled'',(select funding_required from private.system_settings where singleton),''terminal_id'',s.terminal_id,''current_shift''');
end $$;
revoke all on function private.guard_funding_settings(),private.verify_funding_operation(),private.guard_legacy_wallet_adjustment() from public,campuspay_runtime;
insert into private.schema_migrations(version) values('20260921090000_funding_ledger') on conflict do nothing;
