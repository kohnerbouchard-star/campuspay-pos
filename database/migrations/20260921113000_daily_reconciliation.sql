-- Read-only reconciliation: event-date activity plus explicitly current invariants.
-- Applying this migration does not certify or correct any opening balance.
create function private.daily_reconciliation_document(p_day date) returns jsonb
language sql stable security definer set search_path = '' as $$
 with bounds as (select p_day::timestamp at time zone 'Asia/Seoul' lo,(p_day+1)::timestamp at time zone 'Asia/Seoul' hi),
 sales as (select count(*) n,coalesce(sum(s.subtotal_won),0) gross,coalesce(sum(s.discount_won),0) discounts,
  coalesce(sum(s.total_won),0) revenue,coalesce(sum(s.cost_of_goods_sold_won),0) cogs from private.sales s,bounds b where s.created_at>=b.lo and s.created_at<b.hi),
 refunds as (select count(*) n,coalesce(sum(r.total_won),0) amount,coalesce(sum(r.cogs_reversed_won),0) cogs,
  coalesce(sum(r.write_off_cost_won),0) loss from private.sale_refunds r,bounds b where r.created_at>=b.lo and r.created_at<b.hi),
 tenders as (select coalesce(sum(t.settled_amount_won) filter(where t.tender_type='WALLET'),0) wallet,
  coalesce(sum(t.settled_amount_won) filter(where t.tender_type='CASH'),0) cash from private.sale_tenders t
  join private.sales s on s.id=t.sale_id cross join bounds b where s.created_at>=b.lo and s.created_at<b.hi),
 refund_tenders as (select coalesce(sum(t.amount_won) filter(where t.tender_type='WALLET'),0) wallet,
  coalesce(sum(t.amount_won) filter(where t.tender_type='CASH'),0) cash from private.refund_tenders t
  join private.sale_refunds r on r.id=t.refund_id cross join bounds b where r.created_at>=b.lo and r.created_at<b.hi),
 payouts as (select coalesce(sum(p.amount_won),0) cash from private.cash_refund_payouts p,bounds b where p.created_at>=b.lo and p.created_at<b.hi),
 cash_due as (select coalesce(sum(t.amount_won),0) amount from private.refund_tenders t join private.sale_refunds r on r.id=t.refund_id cross join bounds b
  where t.tender_type='CASH' and r.created_at<b.hi and not exists(select 1 from private.cash_refund_payouts p where p.refund_id=r.id and p.created_at<b.hi)),
 funding as (select count(*) n,coalesce(sum(o.wallet_delta_won),0) wallet,
  coalesce(sum(o.wallet_delta_won) filter(where o.action='CASH_DEPOSIT'),0) deposits,
  coalesce(sum(o.wallet_delta_won) filter(where o.action='NONCASH_CREDIT'),0) credits,
  -coalesce(sum(o.wallet_delta_won) filter(where o.action='ADMIN_DEBIT'),0) deductions,
  coalesce(sum(o.wallet_delta_won) filter(where o.action='REVERSE_FUNDING'),0) reversals,
  coalesce(sum(greatest(o.cash_delta_won,0)),0) cash_in,coalesce(sum(greatest(-o.cash_delta_won,0)),0) cash_out
  from private.funding_operations o,bounds b where o.created_at>=b.lo and o.created_at<b.hi),
 wallet_positions as (select l.student_id,coalesce(sum(l.amount_won) filter(where l.created_at<b.lo),0) opening,
  coalesce(sum(l.amount_won) filter(where l.created_at<b.hi),0) ending from private.wallet_ledger l cross join bounds b group by l.student_id),
 wallet_period as (select coalesce(sum(l.amount_won),0) net,coalesce(sum(greatest(l.amount_won,0)),0) inflow,
  coalesce(sum(greatest(-l.amount_won,0)),0) outflow,
  coalesce(sum(l.amount_won) filter(where l.source_type not in ('SALE','ONLINE_ORDER','SALE_REFUND','FUNDING_OPERATION')),0) other
  from private.wallet_ledger l,bounds b where l.created_at>=b.lo and l.created_at<b.hi),
 wallet_ledger_totals as (select l.student_id,sum(l.amount_won) total from private.wallet_ledger l group by l.student_id),
 lot_movements as (select m.lot_id,sum(m.quantity_change) quantity from private.inventory_movements m group by m.lot_id),
 stock as (select count(*) filter(where m.created_at>=b.lo and m.created_at<b.hi) n,
  coalesce(sum(m.total_cost_won) filter(where m.created_at<b.lo),0) opening,
  coalesce(sum(m.total_cost_won) filter(where m.created_at<b.hi),0) ending,
  coalesce(sum(m.total_cost_won) filter(where m.created_at>=b.lo and m.created_at<b.hi and m.movement_type='PURCHASE_RECEIPT'),0) receipts,
  -coalesce(sum(m.total_cost_won) filter(where m.created_at>=b.lo and m.created_at<b.hi and m.movement_type='SALE'),0) sold,
  coalesce(sum(m.total_cost_won) filter(where m.created_at>=b.lo and m.created_at<b.hi and m.movement_type='SALE_REVERSAL'),0) restocked,
  coalesce(sum(m.total_cost_won) filter(where m.created_at>=b.lo and m.created_at<b.hi and m.movement_type not in ('PURCHASE_RECEIPT','SALE','SALE_REVERSAL')),0) adjustments
  from private.inventory_movements m cross join bounds b),
 closes as (select count(*) n,coalesce(sum(c.expected_won),0) expected,coalesce(sum(c.counted_won),0) counted,
  coalesce(sum(c.variance_won),0) variance,count(*) filter(where c.variance_won<>0 and a.shift_id is null) unreviewed
  from private.cash_shift_closes c join private.cash_shifts sh on sh.id=c.shift_id left join private.cash_shift_approvals a on a.shift_id=c.shift_id
  cross join bounds b where sh.closed_at>=b.lo and sh.closed_at<b.hi),
 checked as (
  select 'WALLET_BALANCES' code,'Current wallet balances match their all-time journals' label,count(*) checked_count,
   count(*) filter(where w.balance_won<>coalesce(l.total,0)) discrepancies
   from private.wallets w left join wallet_ledger_totals l on l.student_id=w.student_id
  union all select 'WALLET_ROWS','Wallet journal arithmetic',count(*),count(*) filter(where l.balance_after_won-l.balance_before_won<>l.amount_won) from private.wallet_ledger l
  union all select 'INVENTORY_QUANTITY','Current stock-lot quantities match movement journals',count(*),
   count(*) filter(where l.quantity_remaining<>coalesce(m.quantity,0)) from private.inventory_lots l left join lot_movements m on m.lot_id=l.id
  union all select 'SALE_TENDERS','Sale totals match recorded tenders',count(*),count(*) filter(where
   s.total_won<>coalesce((select sum(t.settled_amount_won) from private.sale_tenders t where t.sale_id=s.id),0)
   or not exists(select 1 from private.sale_tenders t where t.sale_id=s.id)) from private.sales s
  union all select 'SALE_ITEMS','Sale item totals and original cost allocations',count(*),count(*) filter(where
   i.quantity<>coalesce((select sum(a.quantity) from private.sale_cost_allocations a where a.sale_item_id=i.id),0)
   or i.cogs_won<>coalesce((select sum(a.total_cost_won) from private.sale_cost_allocations a where a.sale_item_id=i.id),0)) from private.sale_items i
  union all select 'REFUND_TOTALS','Refund values and cost dispositions reconcile',count(*),count(*) filter(where
   r.total_won<>coalesce((select sum(t.amount_won) from private.refund_tenders t where t.refund_id=r.id),0)
   or r.cogs_reversed_won<>r.restocked_cost_won+r.write_off_cost_won
   or r.cogs_reversed_won<>coalesce((select sum(a.total_cost_won) from private.refund_allocations a where a.refund_id=r.id),0)) from private.sale_refunds r
  union all select 'REFUND_CAPS','Cumulative refunds do not exceed original sales',count(*),count(*) filter(where
   coalesce((select sum(r.total_won) from private.sale_refunds r where r.sale_id=s.id),0)>s.total_won) from private.sales s
  union all select 'REFUND_QUANTITIES','Cumulative returns do not exceed original allocations',count(*),count(*) filter(where
   coalesce((select sum(r.quantity) from private.refund_allocations r where r.original_allocation_id=a.id),0)>a.quantity
   or coalesce((select sum(r.total_cost_won) from private.refund_allocations r where r.original_allocation_id=a.id),0)>a.total_cost_won) from private.sale_cost_allocations a
  union all select 'CASH_CLOSES','Recorded drawer closes match their cash events',count(*),count(*) filter(where
   c.expected_won<>sh.opening_float_won+coalesce((select sum(e.amount_won) from private.cash_shift_events e where e.shift_id=sh.id),0)
   or c.variance_won<>c.counted_won-c.expected_won) from private.cash_shift_closes c join private.cash_shifts sh on sh.id=c.shift_id
  union all select 'FUNDING_LINKS','Funding receipts link to the wallet and cash journals',count(*),count(*) filter(where
   (o.wallet_delta_won<>0 and not exists(select 1 from private.wallet_ledger l where l.id=o.ledger_id and l.source_type='FUNDING_OPERATION'
    and l.source_id=o.id and l.student_id=o.student_id and l.amount_won=o.wallet_delta_won))
   or (o.cash_delta_won<>0 and not exists(select 1 from private.cash_shift_events e where e.source_type='FUNDING_OPERATION'
    and e.source_id=o.id and e.shift_id=o.shift_id and e.amount_won=o.cash_delta_won))) from private.funding_operations o
  union all select 'ORDER_SALES','Online orders link to the correct sale and student',count(*),count(*) filter(where
   not exists(select 1 from private.sales s where s.id=o.sale_id and s.student_id=o.student_id and s.channel='ONLINE_STORE' and s.total_won=o.total_won)) from private.online_orders o
 ),
 metrics as (
 select x.* from sales s,refunds r,tenders t,refund_tenders rt,payouts p,cash_due due,funding f,wallet_period w,stock inv,closes c,
 lateral (values
 ('Sales and refunds','sales_count','Settled sales',s.n,'COUNT','DAY'),
 ('Sales and refunds','gross_sales','Original sales before discounts',s.gross,'KRW','DAY'),
 ('Sales and refunds','discounts','Sale discounts',s.discounts,'KRW','DAY'),
 ('Sales and refunds','refund_count','Refunds posted',r.n,'COUNT','DAY'),
 ('Sales and refunds','refunds','Refunds posted (including older sales)',r.amount,'KRW','DAY'),
 ('Sales and refunds','net_sales','Net sales after discounts and posted refunds',s.revenue-r.amount,'KRW','DAY'),
 ('Sales and refunds','cogs','Original cost of goods sold',s.cogs,'KRW','DAY'),
 ('Sales and refunds','cogs_reversed','Original COGS reversed by refunds',r.cogs,'KRW','DAY'),
 ('Sales and refunds','gross_margin','Net sales minus net COGS, before write-off expenses',s.revenue-r.amount-s.cogs+r.cogs,'KRW','DAY'),
 ('Sales and refunds','return_writeoffs','Returned-goods write-off expense',r.loss,'KRW','DAY'),
 ('Wallet journals','wallet_sales','Wallet tender settled',t.wallet,'KRW','DAY'),
 ('Wallet journals','wallet_refunds','Wallet refund credits',rt.wallet,'KRW','DAY'),
 ('Wallet journals','wallet_deposits','Cash-funded wallet deposits',f.deposits,'KRW','DAY'),
 ('Wallet journals','wallet_credits','Approved non-cash credits',f.credits,'KRW','DAY'),
 ('Wallet journals','wallet_deductions','Approved wallet deductions',f.deductions,'KRW','DAY'),
 ('Wallet journals','funding_reversals','Net receipt-linked funding reversals',f.reversals,'KRW','DAY'),
 ('Wallet journals','wallet_in','All wallet journal increases',w.inflow,'KRW','DAY'),
 ('Wallet journals','wallet_out','All wallet journal decreases',w.outflow,'KRW','DAY'),
 ('Wallet journals','wallet_net','Net wallet journal movement',w.net,'KRW','DAY'),
 ('Wallet journals','wallet_other','Other / legacy journal movement',w.other,'KRW','DAY'),
 ('Physical cash','cash_sales','Cash retained from sales (excludes change)',t.cash,'KRW','DAY'),
 ('Physical cash','cash_refunds_due','Cash refunds approved',rt.cash,'KRW','DAY'),
 ('Physical cash','cash_refunds_paid','Cash refund handovers recorded',p.cash,'KRW','DAY'),
 ('Physical cash','cash_funding_in','Funding and manual cash received',f.cash_in,'KRW','DAY'),
 ('Physical cash','cash_funding_out','Funding reversals, paid-outs and drops',f.cash_out,'KRW','DAY'),
 ('Physical cash','cash_net','Net recorded cash movement, excluding floats',t.cash-p.cash+f.cash_in-f.cash_out,'KRW','DAY'),
 ('Physical cash','cash_due_at_end','Approved cash refunds without a payout by day end',due.amount,'KRW','AT_END'),
 ('Drawer closes','closes','Drawers closed',c.n,'COUNT','DAY'),
 ('Drawer closes','close_expected','Expected cash in those closes',c.expected,'KRW','DAY'),
 ('Drawer closes','close_counted','Counted cash in those closes',c.counted,'KRW','DAY'),
 ('Drawer closes','close_variance','Counted minus expected',c.variance,'KRW','DAY'),
 ('Drawer closes','close_unreviewed','Those variances still awaiting review',c.unreviewed,'COUNT','CURRENT'),
 ('Inventory journal','inventory_opening','Journal carrying value at start',inv.opening,'KRW','AT_START'),
 ('Inventory journal','inventory_receipts','Stock received at landed cost',inv.receipts,'KRW','DAY'),
 ('Inventory journal','inventory_sold','Inventory cost removed for sales',inv.sold,'KRW','DAY'),
 ('Inventory journal','inventory_returned','Saleable stock restored at original cost',inv.restocked,'KRW','DAY'),
 ('Inventory journal','inventory_adjustments','Other inventory cost movements (signed)',inv.adjustments,'KRW','DAY'),
 ('Inventory journal','inventory_ending','Journal carrying value at end',inv.ending,'KRW','AT_END')
 ) x(section,key,label,value,unit,scope)
 union all select 'Wallet journals','wallet_opening','Net wallet position from journals at start',coalesce(sum(opening),0),'KRW','AT_START' from wallet_positions
 union all select 'Wallet journals','wallet_ending','Net wallet position from journals at end',coalesce(sum(ending),0),'KRW','AT_END' from wallet_positions
 union all select 'Wallet journals','prepaid_at_end','Positive prepaid balances from journals',coalesce(sum(greatest(ending,0)),0),'KRW','AT_END' from wallet_positions
 union all select 'Wallet journals','debt_at_end','Student debt from journals, shown separately',coalesce(sum(greatest(-ending,0)),0),'KRW','AT_END' from wallet_positions
 union all select 'Orders','orders_created','Online orders created',count(*),'COUNT','DAY' from private.online_orders o,bounds b where o.created_at>=b.lo and o.created_at<b.hi
 union all select 'Orders','delivered_events','Delivery status events',count(*),'COUNT','DAY' from private.online_order_status_events e,bounds b where e.created_at>=b.lo and e.created_at<b.hi and e.to_status='DELIVERED'
 union all select 'Orders','cancelled_events','Cancellation status events',count(*),'COUNT','DAY' from private.online_order_status_events e,bounds b where e.created_at>=b.lo and e.created_at<b.hi and e.to_status='CANCELLED'
 union all select 'Orders','returned_events','Return status events',count(*),'COUNT','DAY' from private.online_order_status_events e,bounds b where e.created_at>=b.lo and e.created_at<b.hi and e.to_status='RETURNED'
 union all select 'Unresolved operations','open_orders','Orders currently awaiting fulfillment',count(*),'COUNT','CURRENT' from private.online_orders o where o.status in ('PLACED','PICKING','READY','OUT_FOR_DELIVERY')
 union all select 'Unresolved operations','open_drawers','Currently open cash drawers',count(*),'COUNT','CURRENT' from private.cash_shifts sh where sh.closed_at is null
 union all select 'Unresolved operations','funding_requests','Prepared/scanned funding requests needing recovery or closure',count(*),'COUNT','CURRENT' from private.funding_intents i where i.state in ('PREPARED','SCANNED')
 union all select 'Unresolved operations','payment_requests','Unsettled POS requests (including expired requests awaiting closure)',count(*),'COUNT','CURRENT' from private.payment_intents i where i.state in ('awaiting_card','awaiting_pin')
 ), activity as (select s.n+r.n+f.n+i.n n from sales s,refunds r,funding f,stock i)
 select jsonb_build_object('business_date',p_day,'timezone','Asia/Seoul','generated_at',statement_timestamp(),'activity_count',a.n,
  'status',case when exists(select 1 from checked c where c.discrepancies>0) then 'DISCREPANCIES' when a.n=0 then 'NO_POSTED_ACTIVITY' else 'CHECKS_CLEAR' end,
  'metrics',(select jsonb_agg(to_jsonb(m) order by m.section,m.key) from metrics m),
  'checks',(select jsonb_agg(to_jsonb(c) order by c.code) from checked c)) from activity a;
$$;
create function api.daily_reconciliation(p_session_id uuid,p_day date) returns table(result jsonb)
language plpgsql security definer set search_path = '' as $$
begin
 perform private.assert_session(p_session_id,'reports.sales');
 if p_day is null or p_day<date '2000-01-01' or p_day>date '2200-12-31' then raise exception 'BAD_REQUEST'; end if;
 return query select private.daily_reconciliation_document(p_day);
end $$;
revoke all on function private.daily_reconciliation_document(date) from public,campuspay_runtime;
revoke all on function api.daily_reconciliation(uuid,date) from public;
grant execute on function api.daily_reconciliation(uuid,date) to campuspay_runtime;
insert into private.schema_migrations(version) values('20260921113000_daily_reconciliation') on conflict do nothing;
