-- Cumulative item-level refunds with explicit ORIGINAL allocation selection.
-- All commands share the original refund key/recovery fence and journals.
create function private.normalize_partial_selection(p_items jsonb) returns jsonb
language plpgsql immutable set search_path = '' as $$
declare x jsonb; result jsonb;
begin
 if jsonb_typeof(p_items) is distinct from 'array' then raise exception 'BAD_REQUEST'; end if;
 if jsonb_array_length(p_items) not between 1 and 200 then raise exception 'BAD_REQUEST'; end if;
 for x in select value from jsonb_array_elements(p_items) loop
  if jsonb_typeof(x) is distinct from 'object' then raise exception 'BAD_REQUEST'; end if;
  if exists(select 1 from jsonb_object_keys(x) k where k not in ('original_allocation_id','restock_quantity','write_off_quantity'))
   or jsonb_typeof(x->'original_allocation_id') is distinct from 'string'
   or lower(x->>'original_allocation_id') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
   or jsonb_typeof(x->'restock_quantity') is distinct from 'number' or jsonb_typeof(x->'write_off_quantity') is distinct from 'number'
   or x->>'restock_quantity' !~ '^[0-9]{1,9}$' or x->>'write_off_quantity' !~ '^[0-9]{1,9}$'
  then raise exception 'BAD_REQUEST'; end if;
  if (x->>'restock_quantity')::bigint+(x->>'write_off_quantity')::bigint<=0 then raise exception 'BAD_REQUEST'; end if;
 end loop;
 if (select count(distinct lower(value->>'original_allocation_id')) from jsonb_array_elements(p_items))<>jsonb_array_length(p_items) then raise exception 'BAD_REQUEST'; end if;
 select jsonb_agg(jsonb_build_object('original_allocation_id',lower(value->>'original_allocation_id'),
  'restock_quantity',(value->>'restock_quantity')::integer,'write_off_quantity',(value->>'write_off_quantity')::integer) order by lower(value->>'original_allocation_id')) into result from jsonb_array_elements(p_items);
 return result;
end $$;

create function private.partial_refund_plan(p_sale_id uuid,p_items jsonb) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare s private.sales; o private.online_orders; selected jsonb; x jsonb; a record; i record;
 prior_count integer; prior_value bigint; used bigint; nr bigint; nw bigint; amount bigint; net bigint;
 total bigint:=0; rc bigint:=0; wc bigint:=0; wallet_paid bigint; cash_paid bigint; credit bigint;
 allocations jsonb:='[]'::jsonb; lines jsonb:='[]'::jsonb;
begin
 selected:=private.normalize_partial_selection(p_items);
 if p_sale_id is null then raise exception 'BAD_REQUEST'; end if;
 select * into s from private.sales where id=p_sale_id;
 if not found then return jsonb_build_object('outcome','NOT_FOUND'); end if;
 if exists(select 1 from private.sale_refunds where sale_id=s.id and scope='FULL') then return jsonb_build_object('outcome','ALREADY_REFUNDED'); end if;
 select * into o from private.online_orders where sale_id=s.id;
 if s.channel='ONLINE_STORE' and (o.id is null or o.status not in ('OUT_FOR_DELIVERY','DELIVERED')) then return jsonb_build_object('outcome','INELIGIBLE'); end if;
 select count(*),coalesce(sum(total_won),0) into prior_count,prior_value from private.sale_refunds where sale_id=s.id;
 select coalesce(sum(settled_amount_won) filter(where tender_type='WALLET'),0),coalesce(sum(settled_amount_won) filter(where tender_type='CASH'),0)
  into wallet_paid,cash_paid from private.sale_tenders where sale_id=s.id;
 if s.subtotal_won>9007199254740991 or s.cost_of_goods_sold_won>9007199254740991 or s.total_won<>s.subtotal_won-s.discount_won or s.total_won<0 or s.total_won>s.subtotal_won
  or wallet_paid+cash_paid<>s.total_won or prior_value>s.total_won
  or not exists(select 1 from private.sale_tenders where sale_id=s.id)
  or (select count(*) from private.sale_tenders where sale_id=s.id and tender_type='WALLET')>1
  or (select count(*) from private.sale_tenders where sale_id=s.id and tender_type='CASH')>1
  or exists(select 1 from private.sale_tenders t where t.sale_id=s.id and (t.tender_type not in ('WALLET','CASH') or (t.tender_type='WALLET' and t.student_id is distinct from s.student_id)))
  or (select coalesce(sum(line_total_won),0) from private.sale_items where sale_id=s.id)<>s.subtotal_won
  or (select coalesce(sum(cogs_won),0) from private.sale_items where sale_id=s.id)<>s.cost_of_goods_sold_won
  or exists(select 1 from private.sale_items i where i.sale_id=s.id and (i.line_total_won<>i.quantity::numeric*i.unit_price_won
   or (select coalesce(sum(quantity),0) from private.sale_cost_allocations where sale_item_id=i.id)<>i.quantity
   or (select coalesce(sum(total_cost_won),0) from private.sale_cost_allocations where sale_item_id=i.id)<>i.cogs_won))
 then raise exception 'PARTIAL_REFUND_SOURCE_INTEGRITY'; end if;
 for x in select value from jsonb_array_elements(selected) loop
  select c.*,i.product_id,i.sale_id,l.expiration_date into a from private.sale_cost_allocations c join private.sale_items i on i.id=c.sale_item_id
   join private.inventory_lots l on l.id=c.inventory_lot_id where c.id=(x->>'original_allocation_id')::uuid;
  if not found or a.sale_id<>s.id then return jsonb_build_object('outcome','INVALID_SELECTION'); end if;
  nr:=(x->>'restock_quantity')::bigint; nw:=(x->>'write_off_quantity')::bigint;
  select coalesce(sum(quantity),0) into used from private.refund_allocations where original_allocation_id=a.id;
  if used+nr+nw>a.quantity then return jsonb_build_object('outcome','INVALID_SELECTION'); end if;
  if nr>0 and a.expiration_date<(statement_timestamp() at time zone 'Asia/Seoul')::date then return jsonb_build_object('outcome','EXPIRED_STOCK'); end if;
  allocations:=allocations||jsonb_build_array(jsonb_build_object('original_allocation_id',a.id,'sale_item_id',a.sale_item_id,
   'inventory_lot_id',a.inventory_lot_id,'quantity_before',used,'restock_quantity',nr,'write_off_quantity',nw,
   'restocked_cost_won',private.refund_proportional_slice(a.total_cost_won,a.quantity,used,nr),
   'write_off_cost_won',private.refund_proportional_slice(a.total_cost_won,a.quantity,used+nr,nw)));
 end loop;
 for i in select * from private.sale_items where sale_id=s.id order by id loop
  select coalesce(sum((value->>'restock_quantity')::bigint),0),coalesce(sum((value->>'write_off_quantity')::bigint),0) into nr,nw
   from jsonb_array_elements(allocations) where value->>'sale_item_id'=i.id::text;
  if nr+nw=0 then continue; end if;
  select coalesce(sum(a.quantity),0) into used from private.refund_allocations a join private.sale_cost_allocations c on c.id=a.original_allocation_id where c.sale_item_id=i.id;
  net:=private.refund_line_net(i.id);
  amount:=private.refund_proportional_slice(net,i.quantity,used,nr+nw);
  lines:=lines||jsonb_build_array(jsonb_build_object('sale_item_id',i.id,'product_name',i.product_name_snapshot,'quantity_before',used,
   'restock_quantity',nr,'write_off_quantity',nw,'original_line_net_won',net,'refund_won',amount));
  total:=total+amount;
 end loop;
 select coalesce(sum((value->>'restocked_cost_won')::bigint),0),coalesce(sum((value->>'write_off_cost_won')::bigint),0) into rc,wc from jsonb_array_elements(allocations);
 credit:=case when s.total_won=0 then 0 else private.refund_proportional_slice(wallet_paid,s.total_won,prior_value,total) end;
 return jsonb_build_object('outcome','READY','policy_version','PARTIAL_REFUND_LOT_1','sale_id',s.id,'receipt_number',s.receipt_number,
  'prior_refund_count',prior_count,'previous_refund_won',prior_value,'original_total_won',s.total_won,'refund_won',total,
  'wallet_credit_won',credit,'cash_due_won',total-credit,'restocked_cost_won',rc,'write_off_cost_won',wc,'cogs_reversed_won',rc+wc,
  'fully_returned',(select coalesce(sum(quantity),0) from private.sale_items where sale_id=s.id)=
    (select coalesce(sum(a.quantity),0) from private.refund_allocations a join private.sale_cost_allocations c on c.id=a.original_allocation_id join private.sale_items i on i.id=c.sale_item_id where i.sale_id=s.id)
    +(select sum((value->>'restock_quantity')::bigint+(value->>'write_off_quantity')::bigint) from jsonb_array_elements(allocations)),
  'items',lines,'allocations',allocations);
end $$;

create function api.quote_partial_refund(p_session_id uuid,p_sale_id uuid,p_items jsonb) returns table(result jsonb)
language plpgsql security definer set search_path = '' as $$
begin
 perform private.assert_session(p_session_id,'reports.sales');
 if not (select partial_refunds_enabled from private.system_settings where singleton) then return query select jsonb_build_object('outcome','DISABLED'); return; end if;
 return query select private.partial_refund_plan(p_sale_id,p_items);
end $$;

create function api.post_partial_refund(p_session_id uuid,p_sale_id uuid,p_key uuid,p_items jsonb,p_expected_count integer,p_reason_code text,p_notes text,p_verified boolean,p_return_reason text)
returns table(result jsonb) language plpgsql security definer set search_path = '' as $$
declare ss private.staff_sessions; s private.sales; o private.online_orders; settings private.system_settings;
 r private.sale_refunds; closed private.refund_request_closures; w private.wallets; t private.sale_tenders;
 selected jsonb; plan jsonb; x jsonb; a private.sale_cost_allocations; disposition text; n integer; before_qty integer; cost bigint;
 proof text; rid uuid:=gen_random_uuid(); aid uuid; ledger_id uuid; amount bigint; product uuid;
begin
 ss:=private.assert_session(p_session_id,'reports.sales');
 if ss.role_snapshot<>'super_admin' then raise exception 'FORBIDDEN'; end if;
 if p_sale_id is null or p_key is null or p_expected_count is null or p_expected_count<0 or p_verified is distinct from true
  or p_reason_code is null or p_reason_code not in ('CUSTOMER_RETURN','DAMAGED','PRICING_ERROR','OTHER')
  or p_notes is null or length(btrim(p_notes)) not between 10 and 500 or p_notes ~ '[[:cntrl:]]'
  or (p_return_reason is not null and p_return_reason not in ('FAILED_DELIVERY','CUSTOMER_RETURN')) then raise exception 'BAD_REQUEST'; end if;
 selected:=private.normalize_partial_selection(p_items);
 perform pg_advisory_xact_lock(hashtextextended('sale-refund:'||p_key::text,0));
 proof:=encode(extensions.digest(jsonb_build_array('PARTIAL_REFUND_LOT_1',p_sale_id,selected,p_expected_count,p_reason_code,btrim(p_notes),p_return_reason)::text,'sha256'),'hex');
 select * into r from private.sale_refunds where idempotency_key=p_key;
 if found then
  if r.staff_user_id<>ss.auth_user_id or r.terminal_id<>ss.terminal_id or r.sale_id<>p_sale_id or r.request_proof<>proof then
   return query select jsonb_build_object('outcome','IDEMPOTENCY_CONFLICT','refund',null);
  else return query select jsonb_build_object('outcome','COMPLETED','refund',private.refund_document(r.id)); end if;
  return;
 end if;
 select * into closed from private.refund_request_closures where idempotency_key=p_key;
 if found then return query select jsonb_build_object('outcome',case when closed.sale_id=p_sale_id and closed.staff_user_id=ss.auth_user_id then 'CLOSED' else 'IDEMPOTENCY_CONFLICT' end,'refund',null); return; end if;
 select * into settings from private.system_settings where singleton for share;
 if not settings.refunds_enabled or not settings.partial_refunds_enabled or (p_return_reason is not null and not settings.returns_enabled) then
  return query select jsonb_build_object('outcome','DISABLED','refund',null); return;
 end if;
 -- Same order as legacy reversal: session/key/settings -> order -> sale ->
 -- wallet -> sorted products -> lots in configured costing order. No cash
 -- movement occurs here; cash payout remains its separate, shift-locked event.
 select * into o from private.online_orders where sale_id=p_sale_id for update;
 select * into s from private.sales where id=p_sale_id for no key update;
 if not found then return query select jsonb_build_object('outcome','NOT_FOUND','refund',null); return; end if;
 if (s.channel='POS' and p_return_reason is not null) or (s.channel='ONLINE_STORE' and
  (p_return_reason is null or o.id is null or o.status not in ('OUT_FOR_DELIVERY','DELIVERED') or (p_return_reason='FAILED_DELIVERY' and o.status<>'OUT_FOR_DELIVERY'))) then
  return query select jsonb_build_object('outcome','RETURN_INELIGIBLE','refund',null); return;
 end if;
 if (select count(*) from private.sale_refunds where sale_id=s.id)<>p_expected_count then return query select jsonb_build_object('outcome','STALE_REFUND','refund',null); return; end if;
 if s.student_id is not null then select * into strict w from private.wallets where student_id=s.student_id for update; end if;
 perform 1 from public.products p join private.sale_items i on i.product_id=p.id where i.sale_id=s.id order by p.id for share of p;
 perform 1 from private.inventory_lots l where l.id in(select c.inventory_lot_id from private.sale_cost_allocations c join private.sale_items i on i.id=c.sale_item_id where i.sale_id=s.id)
  order by l.product_id,case when settings.inventory_cost_method='FIFO' then l.received_at end asc,case when settings.inventory_cost_method='FIFO' then l.id end asc,
   case when settings.inventory_cost_method='LIFO' then l.received_at end desc,case when settings.inventory_cost_method='LIFO' then l.id end desc for update;
 plan:=private.partial_refund_plan(s.id,selected);
 if plan->>'outcome'<>'READY' then return query select jsonb_build_object('outcome',case when plan->>'outcome'='EXPIRED_STOCK' then 'EXPIRED_STOCK' else 'INVALID_SELECTION' end,'refund',null); return; end if;
 insert into private.sale_refunds(id,sale_id,idempotency_key,request_proof,staff_user_id,staff_session_id,terminal_id,kind,reason_code,notes,total_won,cogs_reversed_won,restocked_cost_won,write_off_cost_won,scope)
 values(rid,s.id,p_key,proof,ss.auth_user_id,ss.id,ss.terminal_id,case when s.channel='POS' then 'POS_REFUND' else 'ONLINE_RETURN' end,p_reason_code,btrim(p_notes),
  (plan->>'refund_won')::bigint,(plan->>'cogs_reversed_won')::bigint,(plan->>'restocked_cost_won')::bigint,(plan->>'write_off_cost_won')::bigint,'PARTIAL');
 insert into private.partial_refund_contexts values(rid,s.id,p_expected_count,(plan->>'previous_refund_won')::bigint,'PARTIAL_REFUND_LOT_1',selected);
 for x in select value from jsonb_array_elements(plan->'items') loop
  insert into private.partial_refund_items values(rid,(x->>'sale_item_id')::uuid,(x->>'quantity_before')::integer,(x->>'restock_quantity')::integer,(x->>'write_off_quantity')::integer,(x->>'original_line_net_won')::bigint,(x->>'refund_won')::bigint);
 end loop;
 for t in select * from private.sale_tenders where sale_id=s.id order by tender_type loop
  ledger_id:=null; amount:=case when t.tender_type='WALLET' then (plan->>'wallet_credit_won')::bigint else (plan->>'cash_due_won')::bigint end;
  if t.tender_type='WALLET' and amount>0 then
   insert into private.wallet_ledger(reference_number,student_id,amount_won,entry_type,reason_code,balance_before_won,balance_after_won,staff_user_id,staff_session_id,source_type,source_id,idempotency_key,notes)
   values('REFUND-'||rid,t.student_id,amount,'REFUND','SALE_REFUND',w.balance_won,w.balance_won+amount,ss.auth_user_id,ss.id,'SALE_REFUND',rid,gen_random_uuid(),btrim(p_notes)) returning id into ledger_id;
   update private.wallets set balance_won=balance_won+amount,updated_at=clock_timestamp() where student_id=t.student_id;
  end if;
  insert into private.refund_tenders(refund_id,original_tender_id,tender_type,amount_won,student_id,wallet_ledger_id) values(rid,t.id,t.tender_type,amount,t.student_id,ledger_id);
 end loop;
 for x in select value from jsonb_array_elements(plan->'allocations') loop
  select * into strict a from private.sale_cost_allocations where id=(x->>'original_allocation_id')::uuid;
  select product_id into strict product from private.sale_items where id=a.sale_item_id;
  foreach disposition in array array['RESTOCK','WRITE_OFF'] loop
   n:=case when disposition='RESTOCK' then (x->>'restock_quantity')::integer else (x->>'write_off_quantity')::integer end;
   if n=0 then continue; end if;
   before_qty:=(x->>'quantity_before')::integer+case when disposition='WRITE_OFF' then (x->>'restock_quantity')::integer else 0 end;
   cost:=case when disposition='RESTOCK' then (x->>'restocked_cost_won')::bigint else (x->>'write_off_cost_won')::bigint end;
   insert into private.refund_allocations(refund_id,original_allocation_id,disposition,quantity,unit_cost_won,total_cost_won,quantity_before)
    values(rid,a.id,disposition,n,a.unit_cost_won,cost,before_qty) returning id into aid;
   if disposition='RESTOCK' then
    update private.inventory_lots set quantity_remaining=quantity_remaining+n where id=a.inventory_lot_id;
    insert into private.inventory_movements(product_id,lot_id,movement_type,quantity_change,unit_cost_won,total_cost_won,reason_code,staff_user_id,staff_session_id,source_type,source_id,idempotency_key)
     values(product,a.inventory_lot_id,'SALE_REVERSAL',n,a.unit_cost_won,cost,'SALE_REFUND_RESTOCK',ss.auth_user_id,ss.id,'REFUND_ALLOCATION',aid,p_key);
   end if;
  end loop;
 end loop;
 if o.id is not null then
  insert into private.online_return_inspections(refund_id,order_id,previous_status,reason,inspection_notes,inspected_by) values(rid,o.id,o.status,p_return_reason,btrim(p_notes),ss.auth_user_id);
  if (plan->>'fully_returned')::boolean then
   update private.online_orders set status='RETURNED',updated_at=clock_timestamp() where id=o.id;
   insert into private.online_order_status_events(order_id,from_status,to_status,source,staff_user_id,staff_session_id) values(o.id,o.status,'RETURNED','STAFF',ss.auth_user_id,ss.id);
  end if;
 end if;
 insert into private.audit_events(event_type,actor_user_id,staff_session_id,subject_type,subject_id,reference_number,safe_payload)
 values('SALE_PARTIALLY_REFUNDED',ss.auth_user_id,ss.id,'SALE_REFUND',rid,'AUD-REFUND-'||rid,jsonb_build_object('sale_id',s.id,'total_won',(plan->>'refund_won')::bigint,'policy_version','PARTIAL_REFUND_LOT_1','all_units_returned',(plan->>'fully_returned')::boolean,'cash_automatically_paid',false));
 return query select jsonb_build_object('outcome','COMPLETED','refund',private.refund_document(rid));
end $$;

-- A fresh full reversal after partial history must refuse, but an old identical
-- full-sale request must still replay its original proof/receipt unchanged.
do $$ declare d text; anchor text:='select * into existing from private.sale_refunds where sale_id=p_sale_id;'; begin
 d:=pg_get_functiondef('private.post_sale_reversal(uuid,uuid,text,text,jsonb,boolean,uuid,text)'::regprocedure);
 if strpos(d,anchor)=0 then raise exception 'FULL_REFUND_PATCH_PRECONDITION'; end if;
 execute replace(d,anchor,E'if exists(select 1 from private.sale_refunds where sale_id=p_sale_id and scope=''PARTIAL'') then\n return query select jsonb_build_object(''outcome'',''PARTIAL_REFUND_EXISTS'',''refund'',null); return; end if;\n '||anchor);
end $$;
revoke all on function private.normalize_partial_selection(jsonb),private.partial_refund_plan(uuid,jsonb) from public,campuspay_runtime;
revoke all on function api.quote_partial_refund(uuid,uuid,jsonb),api.post_partial_refund(uuid,uuid,uuid,jsonb,integer,text,text,boolean,text) from public;
grant execute on function api.quote_partial_refund(uuid,uuid,jsonb),api.post_partial_refund(uuid,uuid,uuid,jsonb,integer,text,text,boolean,text) to campuspay_runtime;
insert into private.schema_migrations(version) values('20260920131000_partial_refund_posting') on conflict do nothing;
