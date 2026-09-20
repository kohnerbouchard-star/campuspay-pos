-- Phase 1.1 foundation: estimates only. No refund/tender/stock journal is changed.
-- Existing full-sale posting, unique constraints and recovery remain untouched.
alter table private.system_settings add column partial_refund_preview_enabled boolean not null default false;

-- Exact cumulative apportionment. numeric multiplication + div avoids bigint
-- overflow and floating-point rounding. Adjacent slices telescope to the total.
create function private.refund_proportional_slice(p_total bigint,p_parts bigint,p_before bigint,p_take bigint)
returns bigint language plpgsql immutable set search_path = '' as $$
begin
 if p_total is null or p_parts is null or p_before is null or p_take is null
  or p_total<0 or p_parts<=0 or p_before<0 or p_take<0
  or p_before::numeric+p_take::numeric>p_parts::numeric then raise exception 'BAD_REQUEST'; end if;
 return (div(p_total::numeric*(p_before::numeric+p_take::numeric),p_parts::numeric)
  -div(p_total::numeric*p_before::numeric,p_parts::numeric))::bigint;
end $$;

-- STABLE provides one financial-data snapshot across this entire calculation.
-- This is NOT authorization, a reservation, or a posting/settlement function.
create function private.partial_refund_preview_document(p_sale_id uuid,p_items jsonb)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
 s private.sales; o private.online_orders; i record; a record; x jsonb; chosen jsonb;
 prefix_won bigint:=0; line_net bigint; line_refund bigint; total_refund bigint:=0;
 wallet_paid bigint; cash_paid bigint; wallet_refund bigint;
 restock_left integer; write_off_left integer; nr integer; nw integer;
 restock_cost bigint; write_off_cost bigint; line_restock bigint; line_write_off bigint;
 total_restock bigint:=0; total_write_off bigint:=0;
 selected_count integer:=0; lines jsonb:='[]'::jsonb; allocations jsonb;
begin
 if p_sale_id is null or jsonb_typeof(p_items) is distinct from 'array' then raise exception 'BAD_REQUEST'; end if;
 if jsonb_array_length(p_items) not between 1 and 100 then raise exception 'BAD_REQUEST'; end if;
 for x in select value from jsonb_array_elements(p_items) loop
  if jsonb_typeof(x) is distinct from 'object' then raise exception 'BAD_REQUEST'; end if;
  if exists(select 1 from jsonb_object_keys(x) k where k not in ('sale_item_id','restock_quantity','write_off_quantity'))
   or jsonb_typeof(x->'sale_item_id') is distinct from 'string'
   or lower(x->>'sale_item_id') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
   or jsonb_typeof(x->'restock_quantity') is distinct from 'number'
   or jsonb_typeof(x->'write_off_quantity') is distinct from 'number' then raise exception 'BAD_REQUEST'; end if;
  if x->>'restock_quantity' !~ '^[0-9]{1,9}$' or x->>'write_off_quantity' !~ '^[0-9]{1,9}$' then raise exception 'BAD_REQUEST'; end if;
  if (x->>'restock_quantity')::integer+(x->>'write_off_quantity')::integer<=0 then raise exception 'BAD_REQUEST'; end if;
 end loop;
 if (select count(distinct lower(value->>'sale_item_id')) from jsonb_array_elements(p_items))<>jsonb_array_length(p_items) then raise exception 'BAD_REQUEST'; end if;
 select * into s from private.sales where id=p_sale_id;
 if not found then return jsonb_build_object('outcome','NOT_FOUND'); end if;
 -- Fail closed on every existing reversal. Multiple partial posting is NOT
 -- installed by this migration; never guess remaining value from old journals.
 if exists(select 1 from private.sale_refunds where sale_id=s.id) then return jsonb_build_object('outcome','ALREADY_REFUNDED'); end if;
 select * into o from private.online_orders where sale_id=s.id;
 if s.channel='ONLINE_STORE' and (o.id is null or o.status not in ('OUT_FOR_DELIVERY','DELIVERED')) then
  return jsonb_build_object('outcome','INELIGIBLE');
 end if;
 if exists(select 1 from jsonb_array_elements(p_items) v where not exists(
  select 1 from private.sale_items si where si.sale_id=s.id and si.id::text=lower(v->>'sale_item_id')
   and (v->>'restock_quantity')::integer+(v->>'write_off_quantity')::integer<=si.quantity)) then
  return jsonb_build_object('outcome','INVALID_SELECTION');
 end if;
 select coalesce(sum(settled_amount_won) filter(where tender_type='WALLET'),0),
  coalesce(sum(settled_amount_won) filter(where tender_type='CASH'),0)
 into wallet_paid,cash_paid from private.sale_tenders where sale_id=s.id;
 if s.subtotal_won>9007199254740991 or s.total_won<>s.subtotal_won-s.discount_won
  or s.total_won<0 or s.total_won>s.subtotal_won or wallet_paid+cash_paid<>s.total_won
  or not exists(select 1 from private.sale_tenders where sale_id=s.id)
  or (select count(*) from private.sale_tenders where sale_id=s.id and tender_type='WALLET')>1
  or (select count(*) from private.sale_tenders where sale_id=s.id and tender_type='CASH')>1
  or exists(select 1 from private.sale_tenders t where t.sale_id=s.id and
   (t.tender_type not in ('WALLET','CASH') or (t.tender_type='WALLET' and t.student_id is distinct from s.student_id)))
  or (select coalesce(sum(si.line_total_won),0) from private.sale_items si where si.sale_id=s.id)<>s.subtotal_won
  or (select coalesce(sum(si.cogs_won),0) from private.sale_items si where si.sale_id=s.id)<>s.cost_of_goods_sold_won
  or exists(select 1 from private.sale_items si where si.sale_id=s.id and
   (si.line_total_won<>si.quantity::numeric*si.unit_price_won::numeric
    or (select coalesce(sum(c.quantity),0) from private.sale_cost_allocations c where c.sale_item_id=si.id)<>si.quantity
    or (select coalesce(sum(c.total_cost_won),0) from private.sale_cost_allocations c where c.sale_item_id=si.id)<>si.cogs_won)) then
  raise exception 'REFUND_PREVIEW_INTEGRITY';
 end if;
 -- Stable item UUID order allocates the original discounted net total once
 -- across ALL lines, not merely the selected lines. Current catalog is unused.
 for i in select * from private.sale_items where sale_id=s.id order by id loop
  line_net:=case when s.subtotal_won=0 then 0 else private.refund_proportional_slice(s.total_won,s.subtotal_won,prefix_won,i.line_total_won) end;
  prefix_won:=prefix_won+i.line_total_won;
  select value into chosen from jsonb_array_elements(p_items) where lower(value->>'sale_item_id')=i.id::text;
  if not found then continue; end if;
  selected_count:=selected_count+1;
  restock_left:=(chosen->>'restock_quantity')::integer; write_off_left:=(chosen->>'write_off_quantity')::integer;
  line_refund:=private.refund_proportional_slice(line_net,i.quantity,0,restock_left+write_off_left);
  line_restock:=0; line_write_off:=0; allocations:='[]'::jsonb;
  -- Restock then write-off consume the next units of the ORIGINAL allocation
  -- sequence. Inspection must later confirm physical lots before any posting.
  for a in select c.*,l.expiration_date from private.sale_cost_allocations c join private.inventory_lots l on l.id=c.inventory_lot_id
   where c.sale_item_id=i.id order by c.created_at,c.id loop
   nr:=least(restock_left,a.quantity); nw:=least(write_off_left,a.quantity-nr);
   if nr+nw=0 then continue; end if;
   if nr>0 and a.expiration_date<(statement_timestamp() at time zone 'Asia/Seoul')::date then
    return jsonb_build_object('outcome','EXPIRED_STOCK');
   end if;
   restock_cost:=private.refund_proportional_slice(a.total_cost_won,a.quantity,0,nr);
   write_off_cost:=private.refund_proportional_slice(a.total_cost_won,a.quantity,nr,nw);
   allocations:=allocations||jsonb_build_array(jsonb_build_object('original_allocation_id',a.id,'inventory_lot_id',a.inventory_lot_id,
    'restock_quantity',nr,'write_off_quantity',nw,'restocked_cost_won',restock_cost,'write_off_cost_won',write_off_cost));
   restock_left:=restock_left-nr; write_off_left:=write_off_left-nw;
   line_restock:=line_restock+restock_cost; line_write_off:=line_write_off+write_off_cost;
  end loop;
  if restock_left<>0 or write_off_left<>0 then raise exception 'REFUND_PREVIEW_INTEGRITY'; end if;
  lines:=lines||jsonb_build_array(jsonb_build_object('sale_item_id',i.id,'product_name',i.product_name_snapshot,
   'sold_quantity',i.quantity,'restock_quantity',(chosen->>'restock_quantity')::integer,'write_off_quantity',(chosen->>'write_off_quantity')::integer,
   'original_line_net_won',line_net,'refund_won',line_refund,'restocked_cost_won',line_restock,'write_off_cost_won',line_write_off,'allocations',allocations));
  total_refund:=total_refund+line_refund; total_restock:=total_restock+line_restock; total_write_off:=total_write_off+line_write_off;
 end loop;
 if selected_count<>jsonb_array_length(p_items) then raise exception 'REFUND_PREVIEW_INTEGRITY'; end if;
 wallet_refund:=case when s.total_won=0 then 0 else private.refund_proportional_slice(wallet_paid,s.total_won,0,total_refund) end;
 return jsonb_build_object('outcome','PREVIEW','preview_only',true,'posting_available',false,
  'policy_version','PARTIAL_REFUND_ALLOCATION_1','coupon_policy','KEEP_REDEMPTION','sale_id',s.id,'receipt_number',s.receipt_number,
  'original_total_won',s.total_won,'refund_won',total_refund,'wallet_credit_won',wallet_refund,'cash_due_won',total_refund-wallet_refund,
  'cogs_reversed_won',total_restock+total_write_off,'restocked_cost_won',total_restock,'write_off_cost_won',total_write_off,
  'calculated_at',statement_timestamp(),'items',lines);
end $$;

create function api.preview_partial_refund(p_session_id uuid,p_sale_id uuid,p_items jsonb)
returns table(result jsonb) language plpgsql security definer set search_path = '' as $$
begin
 perform private.assert_session(p_session_id,'reports.sales');
 if not (select partial_refund_preview_enabled from private.system_settings where singleton) then
  return query select jsonb_build_object('outcome','DISABLED'); return;
 end if;
 return query select private.partial_refund_preview_document(p_sale_id,p_items);
end $$;
revoke all on function private.refund_proportional_slice(bigint,bigint,bigint,bigint),private.partial_refund_preview_document(uuid,jsonb) from public,campuspay_runtime;
revoke all on function api.preview_partial_refund(uuid,uuid,jsonb) from public;
grant execute on function api.preview_partial_refund(uuid,uuid,jsonb) to campuspay_runtime;
insert into private.schema_migrations(version) values('20260920120000_partial_refund_preview') on conflict do nothing;
