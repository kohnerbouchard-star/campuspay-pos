-- Gate 2A: full-sale reversals and staff cancellation before dispatch.
-- Additive and default-off. No real data is changed by applying this migration.
alter table private.system_settings add column refunds_enabled boolean not null default false;

create table private.sale_refunds (
 id uuid primary key default gen_random_uuid(),
 sale_id uuid not null unique references private.sales(id) on delete restrict,
 idempotency_key uuid not null unique,
 request_proof text not null check (request_proof ~ '^[a-f0-9]{64}$'),
 staff_user_id uuid not null references public.staff_profiles(auth_user_id) on delete restrict,
 staff_session_id uuid not null references private.staff_sessions(id) on delete restrict,
 terminal_id uuid not null references private.terminals(id) on delete restrict,
 kind text not null check (kind in ('POS_REFUND','ONLINE_CANCELLATION')),
 reason_code text not null check (reason_code in ('CUSTOMER_RETURN','ORDER_CANCELLED','DAMAGED','PRICING_ERROR','OTHER')),
 notes text not null check (length(btrim(notes)) between 10 and 500),
 total_won bigint not null check (total_won>=0),
 cogs_reversed_won bigint not null check (cogs_reversed_won>=0),
 restocked_cost_won bigint not null check (restocked_cost_won>=0),
 write_off_cost_won bigint not null check (write_off_cost_won>=0),
 coupon_policy text not null default 'KEEP_REDEMPTION' check (coupon_policy='KEEP_REDEMPTION'),
 created_at timestamptz not null default now(),
 check (cogs_reversed_won=restocked_cost_won+write_off_cost_won)
);
create table private.refund_tenders (
 id uuid primary key default gen_random_uuid(),
 refund_id uuid not null references private.sale_refunds(id) on delete restrict,
 original_tender_id uuid not null unique references private.sale_tenders(id) on delete restrict,
 tender_type text not null check(tender_type in ('WALLET','CASH')),
 amount_won bigint not null check(amount_won>=0),
 student_id uuid references private.students(id) on delete restrict,
 wallet_ledger_id uuid unique references private.wallet_ledger(id) on delete restrict,
 unique(refund_id,tender_type),
 check ((tender_type='CASH' and student_id is null and wallet_ledger_id is null)
  or (tender_type='WALLET' and student_id is not null and ((amount_won>0 and wallet_ledger_id is not null) or (amount_won=0 and wallet_ledger_id is null))))
);
create table private.refund_allocations (
 id uuid primary key default gen_random_uuid(),
 refund_id uuid not null references private.sale_refunds(id) on delete restrict,
 original_allocation_id uuid not null unique references private.sale_cost_allocations(id) on delete restrict,
 disposition text not null check(disposition in ('RESTOCK','WRITE_OFF')),
 quantity integer not null check(quantity>0),
 unit_cost_won numeric(18,6) not null check(unit_cost_won>=0),
 total_cost_won bigint not null check(total_cost_won>=0)
);
create table private.refund_request_closures (
 idempotency_key uuid primary key,
 sale_id uuid not null references private.sales(id) on delete restrict,
 staff_user_id uuid not null references public.staff_profiles(auth_user_id) on delete restrict,
 created_at timestamptz not null default now()
);
create table private.cash_refund_payouts (
 id uuid primary key default gen_random_uuid(),
 refund_id uuid not null unique references private.sale_refunds(id) on delete restrict,
 idempotency_key uuid not null unique,
 staff_user_id uuid not null references public.staff_profiles(auth_user_id) on delete restrict,
 staff_session_id uuid not null references private.staff_sessions(id) on delete restrict,
 terminal_id uuid not null references private.terminals(id) on delete restrict,
 amount_won bigint not null check(amount_won>0),
 handover_reference text not null check(length(btrim(handover_reference)) between 3 and 120),
 created_at timestamptz not null default now()
);
create index sale_refunds_created_idx on private.sale_refunds(created_at,id);
create index cash_refund_payouts_terminal_idx on private.cash_refund_payouts(terminal_id,created_at);
do $$ declare n text; begin
 foreach n in array array['sale_refunds','refund_tenders','refund_allocations','refund_request_closures','cash_refund_payouts'] loop
  execute format('create trigger immutable_journal before update or delete on private.%I for each row execute function private.reject_journal_mutation()',n);
  execute format('revoke all on private.%I from public,campuspay_runtime',n);
 end loop;
end $$;

create function private.refund_document(p_id uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
 select jsonb_build_object('refund_id',r.id,'sale_id',r.sale_id,'receipt_number',s.receipt_number,
  'kind',r.kind,'reason_code',r.reason_code,'notes',r.notes,'created_at',r.created_at,
  'total_won',r.total_won,'cogs_reversed_won',r.cogs_reversed_won,'restocked_cost_won',r.restocked_cost_won,
  'write_off_cost_won',r.write_off_cost_won,'coupon_policy',r.coupon_policy,
  'wallet_credit_won',coalesce((select sum(t.amount_won) from private.refund_tenders t where t.refund_id=r.id and t.tender_type='WALLET'),0),
  'cash_due_won',coalesce((select sum(t.amount_won) from private.refund_tenders t where t.refund_id=r.id and t.tender_type='CASH'),0),
  'cash_paid_won',coalesce(p.amount_won,0),'payout_reference',p.handover_reference,'payout_recorded_at',p.created_at,
  'operator_id',r.staff_user_id,'terminal_id',r.terminal_id)
 from private.sale_refunds r join private.sales s on s.id=r.sale_id
 left join private.cash_refund_payouts p on p.refund_id=r.id where r.id=p_id;
$$;

create function private.assert_refund_integrity() returns trigger
language plpgsql security definer set search_path = '' as $$
declare rid uuid; r private.sale_refunds; s private.sales;
begin
 if tg_table_name='sale_refunds' then rid:=new.id; else rid:=new.refund_id; end if;
 select * into strict r from private.sale_refunds where id=rid;
 select * into strict s from private.sales where id=r.sale_id;
 if r.total_won<>s.total_won or r.cogs_reversed_won<>s.cost_of_goods_sold_won
  or (select coalesce(sum(t.amount_won),0) from private.refund_tenders t where t.refund_id=rid)<>r.total_won
  or (select count(*) from private.refund_tenders t where t.refund_id=rid)<>(select count(*) from private.sale_tenders t where t.sale_id=s.id)
  or exists(select 1 from private.refund_tenders t join private.sale_tenders o on o.id=t.original_tender_id where t.refund_id=rid and
   (o.sale_id<>s.id or o.tender_type<>t.tender_type or o.settled_amount_won<>t.amount_won or o.student_id is distinct from t.student_id))
  or exists(select 1 from private.refund_tenders t where t.refund_id=rid and t.tender_type='WALLET' and t.amount_won>0 and not exists(
   select 1 from private.wallet_ledger l where l.id=t.wallet_ledger_id and l.student_id=t.student_id and l.amount_won=t.amount_won
    and l.balance_after_won-l.balance_before_won=t.amount_won and l.source_type='SALE_REFUND' and l.source_id=rid))
  or (select coalesce(sum(a.total_cost_won),0) from private.refund_allocations a where a.refund_id=rid)<>r.cogs_reversed_won
  or (select coalesce(sum(a.total_cost_won),0) from private.refund_allocations a where a.refund_id=rid and a.disposition='RESTOCK')<>r.restocked_cost_won
  or (select count(*) from private.refund_allocations a where a.refund_id=rid)<>(select count(*) from private.sale_cost_allocations a join private.sale_items i on i.id=a.sale_item_id where i.sale_id=s.id)
  or exists(select 1 from private.refund_allocations a join private.sale_cost_allocations o on o.id=a.original_allocation_id join private.sale_items i on i.id=o.sale_item_id
   where a.refund_id=rid and (i.sale_id<>s.id or a.quantity<>o.quantity or a.unit_cost_won<>o.unit_cost_won or a.total_cost_won<>o.total_cost_won))
 then raise exception 'REFUND_INTEGRITY_ERROR'; end if;
 if exists(select 1 from private.refund_allocations a join private.sale_cost_allocations o on o.id=a.original_allocation_id
  where a.refund_id=rid and a.disposition='RESTOCK' and not exists(select 1 from private.inventory_movements m where m.source_type='REFUND_ALLOCATION'
   and m.source_id=a.id and m.lot_id=o.inventory_lot_id and m.quantity_change=a.quantity and m.total_cost_won=a.total_cost_won and m.movement_type='SALE_REVERSAL'))
 then raise exception 'REFUND_STOCK_INTEGRITY_ERROR'; end if;
 if exists(select 1 from private.cash_refund_payouts p where p.refund_id=rid and
  (p.amount_won<>(select coalesce(sum(t.amount_won),0) from private.refund_tenders t where t.refund_id=rid and t.tender_type='CASH')
    or p.staff_user_id<>r.staff_user_id or p.terminal_id<>r.terminal_id)) then raise exception 'REFUND_PAYOUT_INTEGRITY_ERROR'; end if;
 return null;
end $$;
do $$ declare n text; begin
 foreach n in array array['sale_refunds','refund_tenders','refund_allocations','cash_refund_payouts'] loop
  execute format('create constraint trigger refund_reconciliation after insert on private.%I deferrable initially deferred for each row execute function private.assert_refund_integrity()',n);
 end loop;
end $$;

create function api.refund_sale_detail(p_session_id uuid,p_reference text) returns table(result jsonb)
language plpgsql security definer set search_path = '' as $$
begin
 perform private.assert_session(p_session_id,'reports.sales');
 if p_reference is null or length(btrim(p_reference)) not between 1 and 100 then raise exception 'BAD_REQUEST'; end if;
 return query select jsonb_build_object('sale_id',s.id,'receipt_number',s.receipt_number,'sold_at',s.created_at,'channel',s.channel,
  'student_name',st.display_name,'student_code',st.student_code,'year_group',st.year_group,'total_won',s.total_won,
  'cogs_won',s.cost_of_goods_sold_won,'coupon_name',s.coupon_name_snapshot,'order_status',o.status::text,'order_number',o.order_number,
  'wallet_tender_won',(select coalesce(sum(t.settled_amount_won),0) from private.sale_tenders t where t.sale_id=s.id and t.tender_type='WALLET'),
  'cash_tender_won',(select coalesce(sum(t.settled_amount_won),0) from private.sale_tenders t where t.sale_id=s.id and t.tender_type='CASH'),
  'refund',private.refund_document(r.id),'items',coalesce((select jsonb_agg(jsonb_build_object('sale_item_id',i.id,'product_name',i.product_name_snapshot,
    'quantity',i.quantity,'cogs_won',i.cogs_won) order by i.product_id,i.id) from private.sale_items i where i.sale_id=s.id),'[]'::jsonb))
 from private.sales s left join private.students st on st.id=s.student_id left join private.online_orders o on o.sale_id=s.id
 left join private.sale_refunds r on r.sale_id=s.id
 where s.receipt_number=btrim(p_reference) or s.id::text=btrim(p_reference) or o.order_number=btrim(p_reference);
end $$;

create function api.post_sale_refund(p_session_id uuid,p_sale_id uuid,p_reason_code text,p_notes text,p_items jsonb,p_verified boolean,p_idempotency_key uuid)
returns table(result jsonb) language plpgsql security definer set search_path = '' as $$
declare ss private.staff_sessions; s private.sales; o private.online_orders; existing private.sale_refunds; closed private.refund_request_closures;
 settings private.system_settings; proof text; rid uuid:=gen_random_uuid(); a record; t private.sale_tenders; w private.wallets;
 aid uuid; ledger_id uuid; restock bigint; written_off bigint; item_count integer;
begin
 ss:=private.assert_session(p_session_id,'reports.sales');
 if ss.role_snapshot<>'super_admin' then raise exception 'FORBIDDEN'; end if;
 if p_sale_id is null or p_idempotency_key is null or p_verified is distinct from true
  or p_reason_code is null or p_reason_code not in ('CUSTOMER_RETURN','ORDER_CANCELLED','DAMAGED','PRICING_ERROR','OTHER')
  or p_notes is null or length(btrim(p_notes)) not between 10 and 500 or p_notes ~ '[[:cntrl:]]'
  or jsonb_typeof(p_items) is distinct from 'array' then raise exception 'BAD_REQUEST'; end if;
 if jsonb_array_length(p_items) not between 1 and 100 then raise exception 'BAD_REQUEST'; end if;
 if exists(select 1 from jsonb_array_elements(p_items) x where jsonb_typeof(x)<>'object' or x->>'sale_item_id' is null
  or x->>'disposition' is null or x->>'disposition' not in ('RESTOCK','WRITE_OFF')) then raise exception 'BAD_REQUEST'; end if;
 perform pg_advisory_xact_lock(hashtextextended('sale-refund:'||p_idempotency_key::text,0));
 proof:=encode(extensions.digest(jsonb_build_array(p_sale_id,p_reason_code,btrim(p_notes),
  (select jsonb_agg(x order by x->>'sale_item_id') from jsonb_array_elements(p_items) x))::text,'sha256'),'hex');
 select * into existing from private.sale_refunds where idempotency_key=p_idempotency_key;
 if found then
  if existing.staff_user_id<>ss.auth_user_id or existing.sale_id<>p_sale_id or existing.request_proof<>proof then
   return query select jsonb_build_object('outcome','IDEMPOTENCY_CONFLICT','refund',null);
  else return query select jsonb_build_object('outcome','COMPLETED','refund',private.refund_document(existing.id)); end if;
  return;
 end if;
 select * into closed from private.refund_request_closures where idempotency_key=p_idempotency_key;
 if found then
  return query select jsonb_build_object('outcome',case when closed.sale_id=p_sale_id and closed.staff_user_id=ss.auth_user_id then 'CLOSED' else 'IDEMPOTENCY_CONFLICT' end,'refund',null); return;
 end if;
 select * into settings from private.system_settings where singleton for share;
 if not settings.refunds_enabled then return query select jsonb_build_object('outcome','DISABLED','refund',null); return; end if;
 -- Acquire the same order lock used by dispatch BEFORE testing its state.
 select * into o from private.online_orders where sale_id=p_sale_id for update;
 select * into s from private.sales where id=p_sale_id for update;
 if not found then return query select jsonb_build_object('outcome','NOT_FOUND','refund',null); return; end if;
 select * into existing from private.sale_refunds where sale_id=p_sale_id;
 if found then return query select jsonb_build_object('outcome','ALREADY_REFUNDED','refund',private.refund_document(existing.id)); return; end if;
 if s.channel='ONLINE_STORE' and (o.id is null or o.status not in ('PLACED','PICKING','READY')) then
  return query select jsonb_build_object('outcome','ORDER_DISPATCHED','refund',null); return;
 end if;
 select count(*) into item_count from private.sale_items where sale_id=s.id;
 if item_count=0 or item_count<>jsonb_array_length(p_items)
  or (select count(distinct x->>'sale_item_id') from jsonb_array_elements(p_items) x)<>item_count
  or exists(select 1 from jsonb_array_elements(p_items) x where not exists(select 1 from private.sale_items i where i.id::text=x->>'sale_item_id' and i.sale_id=s.id))
 then raise exception 'BAD_REQUEST'; end if;
 if exists(select 1 from private.sale_items i where i.sale_id=s.id and
  ((select coalesce(sum(c.quantity),0) from private.sale_cost_allocations c where c.sale_item_id=i.id)<>i.quantity
   or (select coalesce(sum(c.total_cost_won),0) from private.sale_cost_allocations c where c.sale_item_id=i.id)<>i.cogs_won))
 then raise exception 'REFUND_COST_INTEGRITY_ERROR'; end if;
 -- Match checkout's wallet -> product -> lot lock ordering. Never set a historical balance.
 if s.student_id is not null then select * into strict w from private.wallets where student_id=s.student_id for update; end if;
 perform 1 from public.products p join private.sale_items i on i.product_id=p.id where i.sale_id=s.id order by p.id for share of p;
 perform 1 from private.inventory_lots l where l.id in(select c.inventory_lot_id from private.sale_cost_allocations c join private.sale_items i on i.id=c.sale_item_id where i.sale_id=s.id)
 order by l.product_id,case when settings.inventory_cost_method='FIFO' then l.received_at end asc,
  case when settings.inventory_cost_method='FIFO' then l.id end asc,case when settings.inventory_cost_method='LIFO' then l.received_at end desc,
  case when settings.inventory_cost_method='LIFO' then l.id end desc for update;
 if exists(select 1 from private.sale_cost_allocations c join private.sale_items i on i.id=c.sale_item_id join private.inventory_lots l on l.id=c.inventory_lot_id
  join jsonb_to_recordset(p_items) x(sale_item_id uuid,disposition text) on x.sale_item_id=i.id
  where i.sale_id=s.id and x.disposition='RESTOCK' and l.expiration_date<(clock_timestamp() at time zone 'Asia/Seoul')::date)
 then return query select jsonb_build_object('outcome','EXPIRED_STOCK','refund',null); return; end if;
 select coalesce(sum(c.total_cost_won) filter(where x.disposition='RESTOCK'),0),coalesce(sum(c.total_cost_won) filter(where x.disposition='WRITE_OFF'),0)
 into restock,written_off from private.sale_cost_allocations c join private.sale_items i on i.id=c.sale_item_id
 join jsonb_to_recordset(p_items) x(sale_item_id uuid,disposition text) on x.sale_item_id=i.id where i.sale_id=s.id;
 insert into private.sale_refunds(id,sale_id,idempotency_key,request_proof,staff_user_id,staff_session_id,terminal_id,kind,reason_code,notes,total_won,cogs_reversed_won,restocked_cost_won,write_off_cost_won)
 values(rid,s.id,p_idempotency_key,proof,ss.auth_user_id,ss.id,ss.terminal_id,case when s.channel='POS' then 'POS_REFUND' else 'ONLINE_CANCELLATION' end,p_reason_code,btrim(p_notes),s.total_won,s.cost_of_goods_sold_won,restock,written_off);
 for t in select * from private.sale_tenders where sale_id=s.id order by tender_type loop
  ledger_id:=null;
  if t.tender_type='WALLET' and t.settled_amount_won>0 then
   insert into private.wallet_ledger(reference_number,student_id,amount_won,entry_type,reason_code,balance_before_won,balance_after_won,staff_user_id,staff_session_id,source_type,source_id,idempotency_key,notes)
   values('REFUND-'||rid::text,t.student_id,t.settled_amount_won,'REFUND','SALE_REFUND',w.balance_won,w.balance_won+t.settled_amount_won,ss.auth_user_id,ss.id,'SALE_REFUND',rid,gen_random_uuid(),btrim(p_notes)) returning id into ledger_id;
   update private.wallets set balance_won=balance_won+t.settled_amount_won,updated_at=now() where student_id=t.student_id;
  end if;
  insert into private.refund_tenders(refund_id,original_tender_id,tender_type,amount_won,student_id,wallet_ledger_id)
   values(rid,t.id,t.tender_type,t.settled_amount_won,t.student_id,ledger_id);
 end loop;
 for a in select c.*,i.product_id,x.disposition from private.sale_cost_allocations c join private.sale_items i on i.id=c.sale_item_id
  join jsonb_to_recordset(p_items) x(sale_item_id uuid,disposition text) on x.sale_item_id=i.id where i.sale_id=s.id order by c.id loop
  insert into private.refund_allocations(refund_id,original_allocation_id,disposition,quantity,unit_cost_won,total_cost_won)
   values(rid,a.id,a.disposition,a.quantity,a.unit_cost_won,a.total_cost_won) returning id into aid;
  if a.disposition='RESTOCK' then
   update private.inventory_lots set quantity_remaining=quantity_remaining+a.quantity where id=a.inventory_lot_id;
   insert into private.inventory_movements(product_id,lot_id,movement_type,quantity_change,unit_cost_won,total_cost_won,reason_code,staff_user_id,staff_session_id,source_type,source_id,idempotency_key)
    values(a.product_id,a.inventory_lot_id,'SALE_REVERSAL',a.quantity,a.unit_cost_won,a.total_cost_won,'SALE_REFUND_RESTOCK',ss.auth_user_id,ss.id,'REFUND_ALLOCATION',aid,p_idempotency_key);
  end if;
  -- WRITE_OFF leaves physical stock unchanged; its original cost becomes a separate refund loss, not sale COGS.
 end loop;
 if o.id is not null then
  update private.online_orders set status='CANCELLED',updated_at=now() where id=o.id;
  insert into private.online_order_status_events(order_id,from_status,to_status,source,staff_user_id,staff_session_id)
   values(o.id,o.status,'CANCELLED','STAFF',ss.auth_user_id,ss.id);
 end if;
 insert into private.audit_events(event_type,actor_user_id,staff_session_id,subject_type,subject_id,reference_number,safe_payload)
 values('SALE_REFUNDED',ss.auth_user_id,ss.id,'SALE_REFUND',rid,'AUD-REFUND-'||rid::text,jsonb_build_object('sale_id',s.id,'total_won',s.total_won,'coupon_policy','KEEP_REDEMPTION','cash_automatically_paid',false));
 return query select jsonb_build_object('outcome','COMPLETED','refund',private.refund_document(rid));
end $$;

create function api.recover_sale_refund(p_session_id uuid,p_sale_id uuid,p_idempotency_key uuid) returns table(result jsonb)
language plpgsql security definer set search_path = '' as $$
declare ss private.staff_sessions; r private.sale_refunds; c private.refund_request_closures;
begin
 ss:=private.assert_session(p_session_id,'reports.sales');
 if ss.role_snapshot<>'super_admin' then raise exception 'FORBIDDEN'; end if;
 if p_sale_id is null or p_idempotency_key is null then raise exception 'BAD_REQUEST'; end if;
 perform pg_advisory_xact_lock(hashtextextended('sale-refund:'||p_idempotency_key::text,0));
 select * into r from private.sale_refunds where idempotency_key=p_idempotency_key;
 if found then
  if r.sale_id<>p_sale_id or r.staff_user_id<>ss.auth_user_id then return query select jsonb_build_object('outcome','IDEMPOTENCY_CONFLICT','refund',null);
  else return query select jsonb_build_object('outcome','COMPLETED','refund',private.refund_document(r.id)); end if; return;
 end if;
 select * into c from private.refund_request_closures where idempotency_key=p_idempotency_key;
 if found and (c.sale_id<>p_sale_id or c.staff_user_id<>ss.auth_user_id) then return query select jsonb_build_object('outcome','IDEMPOTENCY_CONFLICT','refund',null); return; end if;
 if not exists(select 1 from private.sales where id=p_sale_id) then return query select jsonb_build_object('outcome','NOT_FOUND','refund',null); return; end if;
 insert into private.refund_request_closures(idempotency_key,sale_id,staff_user_id) values(p_idempotency_key,p_sale_id,ss.auth_user_id) on conflict do nothing;
 return query select jsonb_build_object('outcome','CLOSED','refund',null);
end $$;

create function api.record_refund_cash_payout(p_session_id uuid,p_refund_id uuid,p_idempotency_key uuid,p_amount_won bigint,p_handover_reference text,p_confirmed boolean)
returns table(result jsonb) language plpgsql security definer set search_path = '' as $$
declare ss private.staff_sessions; r private.sale_refunds; p private.cash_refund_payouts; due bigint; pid uuid;
begin
 ss:=private.assert_session(p_session_id,'reports.sales');
 if ss.role_snapshot<>'super_admin' then raise exception 'FORBIDDEN'; end if;
 if p_refund_id is null or p_idempotency_key is null or p_confirmed is distinct from true or p_amount_won is null or p_amount_won<=0
  or p_handover_reference is null or length(btrim(p_handover_reference)) not between 3 and 120 or p_handover_reference ~ '[[:cntrl:]]' then raise exception 'BAD_REQUEST'; end if;
 perform pg_advisory_xact_lock(hashtextextended('refund-payout:'||p_idempotency_key::text,0));
 select * into p from private.cash_refund_payouts where idempotency_key=p_idempotency_key;
 if found and (p.refund_id<>p_refund_id or p.staff_user_id<>ss.auth_user_id or p.amount_won<>p_amount_won or p.handover_reference<>btrim(p_handover_reference)) then raise exception 'CONFLICT'; end if;
 -- Separate payout record: this call records an observed handover; it never dispenses cash.
 perform pg_advisory_xact_lock(hashtextextended('refund-payout-record:'||p_refund_id::text,0));
 select * into r from private.sale_refunds where id=p_refund_id;
 if not found then raise exception 'NOT_FOUND'; end if;
 if r.staff_user_id<>ss.auth_user_id or r.terminal_id<>ss.terminal_id then raise exception 'FORBIDDEN'; end if;
 select coalesce(sum(t.amount_won),0) into due from private.refund_tenders t where t.refund_id=r.id and t.tender_type='CASH';
 if due<=0 or due<>p_amount_won then raise exception 'BAD_REQUEST'; end if;
 if not exists(select 1 from private.cash_refund_payouts where refund_id=r.id) then
  insert into private.cash_refund_payouts(refund_id,idempotency_key,staff_user_id,staff_session_id,terminal_id,amount_won,handover_reference)
   values(r.id,p_idempotency_key,ss.auth_user_id,ss.id,ss.terminal_id,due,btrim(p_handover_reference)) returning id into pid;
  insert into private.audit_events(event_type,actor_user_id,staff_session_id,subject_type,subject_id,reference_number,safe_payload)
   values('REFUND_CASH_PAYOUT_RECORDED',ss.auth_user_id,ss.id,'SALE_REFUND',r.id,'AUD-CASH-REFUND-'||pid::text,jsonb_build_object('cash_paid_won',due,'terminal_id',ss.terminal_id));
 end if;
 return query select jsonb_build_object('outcome','COMPLETED','refund',private.refund_document(r.id));
end $$;

create function api.refund_day_summary(p_session_id uuid,p_from date,p_to date) returns table(result jsonb)
language plpgsql security definer set search_path = '' as $$
declare lo timestamptz; hi timestamptz;
begin
 perform private.assert_session(p_session_id,'reports.sales');
 if p_from is null or p_to is null or p_to<p_from or p_to-p_from>366 then raise exception 'BAD_REQUEST'; end if;
 lo:=p_from::timestamp at time zone 'Asia/Seoul'; hi:=(p_to+1)::timestamp at time zone 'Asia/Seoul';
 return query with sales as(select count(*) as sale_count,coalesce(sum(total_won),0) as gross_sales_won,coalesce(sum(cost_of_goods_sold_won),0) as gross_cogs_won from private.sales where created_at>=lo and created_at<hi),
 refunds as(select count(*) as refund_count,coalesce(sum(total_won),0) as refunds_won,coalesce(sum(cogs_reversed_won),0) as cogs_reversed_won,coalesce(sum(write_off_cost_won),0) as write_off_cost_won from private.sale_refunds where created_at>=lo and created_at<hi),
 cash as(select coalesce(sum(amount_won),0) as cash_paid_won from private.cash_refund_payouts where created_at>=lo and created_at<hi),
 due as(select coalesce(sum(t.amount_won),0) as outstanding_cash_won from private.refund_tenders t join private.sale_refunds r on r.id=t.refund_id where t.tender_type='CASH' and r.created_at<hi and not exists(select 1 from private.cash_refund_payouts p where p.refund_id=r.id and p.created_at<hi))
 select jsonb_build_object('sale_count',s.sale_count,'refund_count',r.refund_count,'gross_sales_won',s.gross_sales_won,'refunds_won',r.refunds_won,
 'net_sales_won',s.gross_sales_won-r.refunds_won,'gross_cogs_won',s.gross_cogs_won,'cogs_reversed_won',r.cogs_reversed_won,'write_off_cost_won',r.write_off_cost_won,
 'net_margin_won',s.gross_sales_won-r.refunds_won-s.gross_cogs_won+r.cogs_reversed_won-r.write_off_cost_won,'cash_paid_won',c.cash_paid_won,'outstanding_cash_won',d.outstanding_cash_won)
 from sales s cross join refunds r cross join cash c cross join due d;
end $$;

revoke all on function private.refund_document(uuid),private.assert_refund_integrity() from public,campuspay_runtime;
revoke all on function api.refund_sale_detail(uuid,text),api.post_sale_refund(uuid,uuid,text,text,jsonb,boolean,uuid),api.recover_sale_refund(uuid,uuid,uuid),api.record_refund_cash_payout(uuid,uuid,uuid,bigint,text,boolean),api.refund_day_summary(uuid,date,date) from public;
grant execute on function api.refund_sale_detail(uuid,text),api.post_sale_refund(uuid,uuid,text,text,jsonb,boolean,uuid),api.recover_sale_refund(uuid,uuid,uuid),api.record_refund_cash_payout(uuid,uuid,uuid,bigint,text,boolean),api.refund_day_summary(uuid,date,date) to campuspay_runtime;
insert into private.schema_migrations(version) values('20260918150000_sale_refunds') on conflict do nothing;
