-- Shared refund documents, independently addressable payouts, complete per-sale
-- paginated refund history and a separately authorized student projection.
create or replace function private.refund_document(p_id uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
 select jsonb_build_object('refund_id',r.id,'sale_id',r.sale_id,'receipt_number',s.receipt_number,'scope',r.scope,
  'kind',r.kind,'reason_code',r.reason_code,'notes',r.notes,'created_at',r.created_at,
  'total_won',r.total_won,'cogs_reversed_won',r.cogs_reversed_won,'restocked_cost_won',r.restocked_cost_won,
  'write_off_cost_won',r.write_off_cost_won,'coupon_policy',r.coupon_policy,
  'wallet_credit_won',coalesce((select sum(t.amount_won) from private.refund_tenders t where t.refund_id=r.id and t.tender_type='WALLET'),0),
  'cash_due_won',coalesce((select sum(t.amount_won) from private.refund_tenders t where t.refund_id=r.id and t.tender_type='CASH'),0),
  'cash_paid_won',coalesce(p.amount_won,0),'payout_reference',p.handover_reference,'payout_recorded_at',p.created_at,
  'operator_id',r.staff_user_id,'terminal_id',r.terminal_id,
  'items',coalesce((select jsonb_agg(jsonb_build_object('product_name',i.product_name_snapshot,'quantity',x.restock_quantity+x.write_off_quantity,
   'restock_quantity',x.restock_quantity,'write_off_quantity',x.write_off_quantity,'refund_won',x.refund_won) order by i.id)
   from private.partial_refund_items x join private.sale_items i on i.id=x.sale_item_id where x.refund_id=r.id),'[]'::jsonb))
 from private.sale_refunds r join private.sales s on s.id=r.sale_id
 left join private.cash_refund_payouts p on p.refund_id=r.id where r.id=p_id;
$$;
-- The original endpoint keeps its single-row contract; a displayed refund is
-- explicitly the latest receipt, not the total of a series of partial refunds.
do $$ declare d text; anchor text:='left join private.sale_refunds r on r.sale_id=s.id'; begin
 d:=pg_get_functiondef('api.refund_sale_detail(uuid,text)'::regprocedure);
 if strpos(d,anchor)=0 then raise exception 'REFUND_DETAIL_PATCH_PRECONDITION'; end if;
 execute replace(d,anchor,'left join lateral (select * from private.sale_refunds x where x.sale_id=s.id order by x.created_at desc,x.id desc limit 1) r on true');
end $$;

create function api.refund_record(p_session_id uuid,p_refund_id uuid) returns table(result jsonb)
language plpgsql security definer set search_path = '' as $$
begin
 perform private.assert_session(p_session_id,'reports.sales');
 return query select private.refund_document(id) from private.sale_refunds where id=p_refund_id;
end $$;

create function api.partial_refund_snapshot(p_session_id uuid,p_reference text,p_offset integer default 0) returns table(result jsonb)
language plpgsql security definer set search_path = '' as $$
declare doc jsonb; sid uuid;
begin
 perform private.assert_session(p_session_id,'reports.sales');
 if p_offset is null or p_offset<0 or p_offset>2147483597 then raise exception 'BAD_REQUEST'; end if;
 select d.result into doc from api.refund_sale_detail(p_session_id,p_reference) d;
 if doc is null then return; end if;
 sid:=(doc->>'sale_id')::uuid;
 return query select jsonb_build_object('sale',doc,'offset',p_offset,
  'enabled',(select partial_refunds_enabled and refunds_enabled from private.system_settings where singleton),
  'returns_enabled',(select returns_enabled from private.system_settings where singleton),
  'refund_count',(select count(*) from private.sale_refunds where sale_id=sid),
  'refunded_won',(select coalesce(sum(total_won),0) from private.sale_refunds where sale_id=sid),
  'refunds',coalesce((select jsonb_agg(private.refund_document(x.id) order by x.created_at desc,x.id desc) from
   (select id,created_at from private.sale_refunds where sale_id=sid order by created_at desc,id desc limit 50 offset p_offset) x),'[]'::jsonb),
  'allocations',coalesce((select jsonb_agg(jsonb_build_object('original_allocation_id',a.id,'sale_item_id',i.id,
   'product_name',i.product_name_snapshot,'inventory_lot_id',l.id,'lot_code',sl.supplier_lot_code,'stock_receipt',sr.receipt_number,
   'received_at',l.received_at,'expiration_date',l.expiration_date,'sold_quantity',a.quantity,
   'remaining_quantity',a.quantity-coalesce((select sum(quantity) from private.refund_allocations where original_allocation_id=a.id),0)) order by i.id,l.received_at,a.id)
   from private.sale_cost_allocations a join private.sale_items i on i.id=a.sale_item_id join private.inventory_lots l on l.id=a.inventory_lot_id
   join private.stock_receipt_lines sl on sl.id=l.receipt_line_id join private.stock_receipts sr on sr.id=sl.receipt_id where i.sale_id=sid),'[]'::jsonb));
end $$;

create function api.customer_order_refunds(p_customer_session_id uuid,p_order_id uuid,p_offset integer default 0) returns table(result jsonb)
language plpgsql security definer set search_path = '' as $$
declare cs private.customer_sessions; o private.online_orders;
begin
 cs:=private.assert_customer_session(p_customer_session_id);
 if p_order_id is null or p_offset is null or p_offset<0 or p_offset>2147483597 then raise exception 'BAD_REQUEST'; end if;
 select * into o from private.online_orders where id=p_order_id and student_id=cs.student_id;
 if not found then raise exception 'NOT_FOUND'; end if;
 return query select jsonb_build_object('order_id',o.id,'refund_count',(select count(*) from private.sale_refunds where sale_id=o.sale_id),
  'refunded_won',(select coalesce(sum(total_won),0) from private.sale_refunds where sale_id=o.sale_id),
  'offset',p_offset,'refunds',coalesce((select jsonb_agg(jsonb_build_object('refund_id',r.id,'scope',r.scope,'created_at',r.created_at,
   'total_won',r.total_won,'wallet_credit_won',coalesce((select sum(amount_won) from private.refund_tenders where refund_id=r.id and tender_type='WALLET'),0),
   'items',coalesce((select jsonb_agg(jsonb_build_object('product_name',i.product_name_snapshot,'quantity',x.restock_quantity+x.write_off_quantity,'refund_won',x.refund_won) order by i.id)
    from private.partial_refund_items x join private.sale_items i on i.id=x.sale_item_id where x.refund_id=r.id),'[]'::jsonb)) order by r.created_at desc,r.id desc)
   from (select * from private.sale_refunds where sale_id=o.sale_id order by created_at desc,id desc limit 50 offset p_offset) r),'[]'::jsonb));
end $$;
revoke all on function api.refund_record(uuid,uuid),api.partial_refund_snapshot(uuid,text,integer),api.customer_order_refunds(uuid,uuid,integer) from public;
grant execute on function api.refund_record(uuid,uuid),api.partial_refund_snapshot(uuid,text,integer),api.customer_order_refunds(uuid,uuid,integer) to campuspay_runtime;
insert into private.schema_migrations(version) values('20260920132000_partial_refund_read_models') on conflict do nothing;
