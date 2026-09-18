-- Full-sale post-dispatch returns reuse the reviewed reversal engine, never a fake pre-dispatch state.
alter table private.system_settings add column returns_enabled boolean not null default false;
alter table private.sale_refunds drop constraint sale_refunds_kind_check;
alter table private.sale_refunds add constraint sale_refunds_kind_check check(kind in ('POS_REFUND','ONLINE_CANCELLATION','ONLINE_RETURN'));
create table private.online_return_inspections (
 refund_id uuid primary key references private.sale_refunds(id) on delete restrict,
 order_id uuid not null unique references private.online_orders(id) on delete restrict,
 previous_status private.online_order_state not null check(previous_status in ('OUT_FOR_DELIVERY','DELIVERED')),
 reason text not null check(reason in ('FAILED_DELIVERY','CUSTOMER_RETURN')),
 inspection_notes text not null check(length(btrim(inspection_notes)) between 10 and 500),
 inspected_by uuid not null references public.staff_profiles(auth_user_id) on delete restrict,
 inspected_at timestamptz not null default now()
);
create trigger immutable_journal before update or delete on private.online_return_inspections
for each row execute function private.reject_journal_mutation();
revoke all on private.online_return_inspections from public,campuspay_runtime;

create function private.post_sale_reversal(p_session_id uuid,p_sale_id uuid,p_reason_code text,p_notes text,p_items jsonb,p_verified boolean,p_idempotency_key uuid,p_return_reason text)
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
 if p_return_reason is not null and p_return_reason not in ('FAILED_DELIVERY','CUSTOMER_RETURN') then raise exception 'BAD_REQUEST'; end if;
 if jsonb_array_length(p_items) not between 1 and 100 then raise exception 'BAD_REQUEST'; end if;
 if exists(select 1 from jsonb_array_elements(p_items) x where jsonb_typeof(x)<>'object' or x->>'sale_item_id' is null
  or x->>'disposition' is null or x->>'disposition' not in ('RESTOCK','WRITE_OFF')) then raise exception 'BAD_REQUEST'; end if;
 perform pg_advisory_xact_lock(hashtextextended('sale-refund:'||p_idempotency_key::text,0));
 proof:=encode(extensions.digest(jsonb_build_array(p_sale_id,p_reason_code,btrim(p_notes),
  (select jsonb_agg(x order by x->>'sale_item_id') from jsonb_array_elements(p_items) x))::text,'sha256'),'hex');
 if p_return_reason is not null then proof:=encode(extensions.digest(jsonb_build_array('ONLINE_RETURN_V1',proof,p_return_reason)::text,'sha256'),'hex'); end if;
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
 if not settings.refunds_enabled or (p_return_reason is not null and not settings.returns_enabled) then return query select jsonb_build_object('outcome','DISABLED','refund',null); return; end if;
 -- Acquire the same order lock used by dispatch BEFORE testing its state.
 select * into o from private.online_orders where sale_id=p_sale_id for update;
 select * into s from private.sales where id=p_sale_id for update;
 if not found then return query select jsonb_build_object('outcome','NOT_FOUND','refund',null); return; end if;
 select * into existing from private.sale_refunds where sale_id=p_sale_id;
 if found then return query select jsonb_build_object('outcome','ALREADY_REFUNDED','refund',private.refund_document(existing.id)); return; end if;
 if p_return_reason is not null then
  if s.channel<>'ONLINE_STORE' or o.id is null or o.status not in ('OUT_FOR_DELIVERY','DELIVERED')
    or (p_return_reason='FAILED_DELIVERY' and o.status<>'OUT_FOR_DELIVERY') then
   return query select jsonb_build_object('outcome','RETURN_INELIGIBLE','refund',null); return;
  end if;
 elsif s.channel='ONLINE_STORE' and (o.id is null or o.status not in ('PLACED','PICKING','READY')) then
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
 values(rid,s.id,p_idempotency_key,proof,ss.auth_user_id,ss.id,ss.terminal_id,case when p_return_reason is not null then 'ONLINE_RETURN' when s.channel='POS' then 'POS_REFUND' else 'ONLINE_CANCELLATION' end,p_reason_code,btrim(p_notes),s.total_won,s.cost_of_goods_sold_won,restock,written_off);
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
  if p_return_reason is not null then
   insert into private.online_return_inspections(refund_id,order_id,previous_status,reason,inspection_notes,inspected_by)
    values(rid,o.id,o.status,p_return_reason,btrim(p_notes),ss.auth_user_id);
  end if;
  update private.online_orders set status=case when p_return_reason is null then 'CANCELLED'::private.online_order_state else 'RETURNED'::private.online_order_state end,updated_at=now() where id=o.id;
  insert into private.online_order_status_events(order_id,from_status,to_status,source,staff_user_id,staff_session_id)
   values(o.id,o.status,case when p_return_reason is null then 'CANCELLED'::private.online_order_state else 'RETURNED'::private.online_order_state end,'STAFF',ss.auth_user_id,ss.id);
 end if;
 insert into private.audit_events(event_type,actor_user_id,staff_session_id,subject_type,subject_id,reference_number,safe_payload)
 values('SALE_REFUNDED',ss.auth_user_id,ss.id,'SALE_REFUND',rid,'AUD-REFUND-'||rid::text,jsonb_build_object('sale_id',s.id,'total_won',s.total_won,'coupon_policy','KEEP_REDEMPTION','cash_automatically_paid',false));
 return query select jsonb_build_object('outcome','COMPLETED','refund',private.refund_document(rid));
end $$;


-- Keep the original API and its proof format backward-compatible.
create or replace function api.post_sale_refund(p_session_id uuid,p_sale_id uuid,p_reason_code text,p_notes text,p_items jsonb,p_verified boolean,p_idempotency_key uuid)
returns table(result jsonb) language sql security definer set search_path = '' as $$
 select * from private.post_sale_reversal(p_session_id,p_sale_id,p_reason_code,p_notes,p_items,p_verified,p_idempotency_key,null);
$$;
create function api.post_online_return(p_session_id uuid,p_sale_id uuid,p_reason_code text,p_notes text,p_items jsonb,p_verified boolean,p_idempotency_key uuid,p_return_reason text)
returns table(result jsonb) language plpgsql security definer set search_path = '' as $$
begin
 if p_return_reason is null then raise exception 'BAD_REQUEST'; end if;
 return query select * from private.post_sale_reversal(p_session_id,p_sale_id,p_reason_code,p_notes,p_items,p_verified,p_idempotency_key,p_return_reason);
end $$;
revoke all on function private.post_sale_reversal(uuid,uuid,text,text,jsonb,boolean,uuid,text) from public,campuspay_runtime;
revoke all on function api.post_online_return(uuid,uuid,text,text,jsonb,boolean,uuid,text) from public;
grant execute on function api.post_online_return(uuid,uuid,text,text,jsonb,boolean,uuid,text) to campuspay_runtime;
insert into private.schema_migrations(version) values('20260918171000_online_returns') on conflict do nothing;
