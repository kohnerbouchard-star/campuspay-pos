-- Extend the shared immutable reversal journal. Previously published migrations
-- and legacy full-sale request proofs remain unchanged. No live activation.
alter table private.system_settings add column partial_refunds_enabled boolean not null default false;
alter table private.sale_refunds add column scope text not null default 'FULL' check(scope in ('FULL','PARTIAL'));
alter table private.sale_refunds drop constraint sale_refunds_sale_id_key;
create unique index one_full_refund_per_sale on private.sale_refunds(sale_id) where scope='FULL';
create index refunds_sale_history on private.sale_refunds(sale_id,created_at,id);
alter table private.refund_tenders drop constraint refund_tenders_original_tender_id_key;
create index refund_tenders_original_idx on private.refund_tenders(original_tender_id);
alter table private.refund_allocations drop constraint refund_allocations_original_allocation_id_key;
alter table private.refund_allocations add column quantity_before integer check(quantity_before>=0);
create unique index refund_allocation_disposition on private.refund_allocations(refund_id,original_allocation_id,disposition);
create index refund_allocations_original_idx on private.refund_allocations(original_allocation_id);
alter table private.online_return_inspections drop constraint online_return_inspections_order_id_key;
create index return_inspections_order_idx on private.online_return_inspections(order_id);
create table private.partial_refund_contexts (
 refund_id uuid primary key references private.sale_refunds(id) on delete restrict,
 sale_id uuid not null references private.sales(id) on delete restrict,
 prior_refund_count integer not null check(prior_refund_count>=0),
 previous_refund_won bigint not null check(previous_refund_won>=0),
 policy_version text not null check(policy_version='PARTIAL_REFUND_LOT_1'),
 selection jsonb not null check(jsonb_typeof(selection)='array'),
 unique(sale_id,prior_refund_count)
);
create table private.partial_refund_items (
 refund_id uuid not null references private.sale_refunds(id) on delete restrict,
 sale_item_id uuid not null references private.sale_items(id) on delete restrict,
 quantity_before integer not null check(quantity_before>=0),
 restock_quantity integer not null check(restock_quantity>=0),
 write_off_quantity integer not null check(write_off_quantity>=0),
 original_line_net_won bigint not null check(original_line_net_won>=0),
 refund_won bigint not null check(refund_won>=0),
 primary key(refund_id,sale_item_id), check(restock_quantity::bigint+write_off_quantity>0)
);
create index partial_items_original_idx on private.partial_refund_items(sale_item_id);
do $$ declare n text; begin
 foreach n in array array['partial_refund_contexts','partial_refund_items'] loop
  execute format('create trigger immutable_journal before update or delete on private.%I for each row execute function private.reject_journal_mutation()',n);
  execute format('revoke all on private.%I from public,campuspay_runtime',n);
 end loop;
end $$;

create function private.refund_line_net(p_item_id uuid) returns bigint
language sql stable security definer set search_path = '' as $$
 select case when s.subtotal_won=0 then 0 else private.refund_proportional_slice(s.total_won,s.subtotal_won,
  coalesce((select sum(b.line_total_won) from private.sale_items b where b.sale_id=s.id and b.id<i.id),0)::bigint,i.line_total_won) end
 from private.sale_items i join private.sales s on s.id=i.sale_id where i.id=p_item_id;
$$;

-- Serializes even direct journal insertion with the legacy and new commands.
create function private.lock_refund_sale() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
 perform 1 from private.sales where id=new.sale_id for no key update;
 if exists(select 1 from private.sale_refunds where sale_id=new.sale_id and (scope='FULL' or new.scope='FULL')) then
  raise exception 'CONFLICT';
 end if;
 return new;
end $$;
create trigger refund_sale_mutex before insert on private.sale_refunds for each row execute function private.lock_refund_sale();

create function private.assert_partial_refund_integrity(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare r private.sale_refunds; s private.sales; c private.partial_refund_contexts; i record; a record;
 prior bigint; wallet_paid bigint; expected_wallet bigint; nr bigint; nw bigint;
begin
 select * into strict r from private.sale_refunds where id=p_id;
 select * into strict s from private.sales where id=r.sale_id;
 select * into c from private.partial_refund_contexts where refund_id=r.id;
 if c.refund_id is null or c.sale_id<>s.id or r.scope<>'PARTIAL' or r.kind not in ('POS_REFUND','ONLINE_RETURN')
  or (s.channel='POS')<>(r.kind='POS_REFUND') then raise exception 'PARTIAL_REFUND_INTEGRITY'; end if;
 if c.prior_refund_count<>(select count(*) from private.partial_refund_contexts x where x.sale_id=s.id and x.prior_refund_count<c.prior_refund_count)
  or c.previous_refund_won<>(select coalesce(sum(x.total_won),0) from private.sale_refunds x join private.partial_refund_contexts y on y.refund_id=x.id
   where x.sale_id=s.id and y.prior_refund_count<c.prior_refund_count)
  or c.selection is distinct from (select jsonb_agg(jsonb_build_object('original_allocation_id',x.original_allocation_id,
    'restock_quantity',x.nr,'write_off_quantity',x.nw) order by x.original_allocation_id) from
    (select original_allocation_id,coalesce(sum(quantity) filter(where disposition='RESTOCK'),0) nr,coalesce(sum(quantity) filter(where disposition='WRITE_OFF'),0) nw
     from private.refund_allocations where refund_id=r.id group by original_allocation_id) x)
  or not exists(select 1 from private.partial_refund_items where refund_id=r.id)
  or r.total_won<>(select coalesce(sum(refund_won),0) from private.partial_refund_items where refund_id=r.id)
  or r.cogs_reversed_won<>(select coalesce(sum(total_cost_won),0) from private.refund_allocations where refund_id=r.id)
  or r.restocked_cost_won<>(select coalesce(sum(total_cost_won),0) from private.refund_allocations where refund_id=r.id and disposition='RESTOCK')
 then raise exception 'PARTIAL_REFUND_INTEGRITY'; end if;
 for i in select x.*,o.quantity,o.sale_id from private.partial_refund_items x join private.sale_items o on o.id=x.sale_item_id where x.refund_id=r.id loop
  select coalesce(sum(x.restock_quantity::bigint+x.write_off_quantity),0) into prior from private.partial_refund_items x
   join private.partial_refund_contexts y on y.refund_id=x.refund_id where x.sale_item_id=i.sale_item_id and y.prior_refund_count<c.prior_refund_count;
  select coalesce(sum(x.quantity) filter(where x.disposition='RESTOCK'),0),coalesce(sum(x.quantity) filter(where x.disposition='WRITE_OFF'),0) into nr,nw
   from private.refund_allocations x join private.sale_cost_allocations o on o.id=x.original_allocation_id where x.refund_id=r.id and o.sale_item_id=i.sale_item_id;
  if i.sale_id<>s.id or i.quantity_before<>prior or i.quantity_before::bigint+i.restock_quantity+i.write_off_quantity>i.quantity
   or i.restock_quantity<>nr or i.write_off_quantity<>nw or i.original_line_net_won<>private.refund_line_net(i.sale_item_id)
   or i.refund_won<>private.refund_proportional_slice(i.original_line_net_won,i.quantity,i.quantity_before,i.restock_quantity::bigint+i.write_off_quantity)
  then raise exception 'PARTIAL_REFUND_ITEM_INTEGRITY'; end if;
 end loop;
 for a in select x.*,o.quantity original_quantity,o.total_cost_won original_cost,o.unit_cost_won original_unit_cost,o.sale_item_id,o.inventory_lot_id,i.sale_id
  from private.refund_allocations x join private.sale_cost_allocations o on o.id=x.original_allocation_id
  join private.sale_items i on i.id=o.sale_item_id where x.refund_id=r.id loop
  select coalesce(sum(x.quantity),0) into prior from private.refund_allocations x join private.partial_refund_contexts y on y.refund_id=x.refund_id
   where x.original_allocation_id=a.original_allocation_id and y.prior_refund_count<c.prior_refund_count;
  if a.disposition='WRITE_OFF' then prior:=prior+coalesce((select quantity from private.refund_allocations where refund_id=r.id and original_allocation_id=a.original_allocation_id and disposition='RESTOCK'),0); end if;
  if a.sale_id<>s.id or not exists(select 1 from private.partial_refund_items where refund_id=r.id and sale_item_id=a.sale_item_id)
   or a.quantity_before is distinct from prior or prior+a.quantity>a.original_quantity or a.unit_cost_won<>a.original_unit_cost
   or a.total_cost_won<>private.refund_proportional_slice(a.original_cost,a.original_quantity,prior,a.quantity)
  then raise exception 'PARTIAL_REFUND_COST_INTEGRITY'; end if;
  if a.disposition='RESTOCK' and (select count(*) from private.inventory_movements m where m.source_type='REFUND_ALLOCATION' and m.source_id=a.id
   and m.lot_id=a.inventory_lot_id and m.quantity_change=a.quantity and m.total_cost_won=a.total_cost_won and m.movement_type='SALE_REVERSAL')<>1
   then raise exception 'REFUND_STOCK_INTEGRITY_ERROR'; end if;
  if a.disposition='WRITE_OFF' and exists(select 1 from private.inventory_movements m where m.source_type='REFUND_ALLOCATION' and m.source_id=a.id)
   then raise exception 'REFUND_STOCK_INTEGRITY_ERROR'; end if;
 end loop;
 select coalesce(sum(settled_amount_won),0) into wallet_paid from private.sale_tenders where sale_id=s.id and tender_type='WALLET';
 expected_wallet:=case when s.total_won=0 then 0 else private.refund_proportional_slice(wallet_paid,s.total_won,c.previous_refund_won,r.total_won) end;
 if (select count(*) from private.refund_tenders where refund_id=r.id)<>(select count(*) from private.sale_tenders where sale_id=s.id)
  or (select coalesce(sum(amount_won),0) from private.refund_tenders where refund_id=r.id)<>r.total_won
  or exists(select 1 from private.refund_tenders t join private.sale_tenders o on o.id=t.original_tender_id where t.refund_id=r.id and
   (o.sale_id<>s.id or t.tender_type<>o.tender_type or t.student_id is distinct from o.student_id
    or t.amount_won<>case when t.tender_type='WALLET' then expected_wallet else r.total_won-expected_wallet end))
  or exists(select 1 from private.refund_tenders t where t.refund_id=r.id and t.tender_type='WALLET' and t.amount_won>0 and not exists(
   select 1 from private.wallet_ledger l where l.id=t.wallet_ledger_id and l.student_id=t.student_id and l.amount_won=t.amount_won
    and l.balance_after_won-l.balance_before_won=t.amount_won and l.source_type='SALE_REFUND' and l.source_id=r.id))
 then raise exception 'PARTIAL_REFUND_TENDER_INTEGRITY'; end if;
 if exists(select 1 from private.cash_refund_payouts p where p.refund_id=r.id and
  (p.amount_won<>r.total_won-expected_wallet or p.staff_user_id<>r.staff_user_id or p.terminal_id<>r.terminal_id)) then raise exception 'REFUND_PAYOUT_INTEGRITY_ERROR'; end if;
 if r.kind='ONLINE_RETURN' and not exists(select 1 from private.online_return_inspections x join private.online_orders o on o.id=x.order_id
  where x.refund_id=r.id and o.sale_id=s.id and x.inspected_by=r.staff_user_id) then raise exception 'PARTIAL_RETURN_INSPECTION_REQUIRED'; end if;
end $$;

-- Retain every legacy full-refund check; dispatch only the new scope to its
-- separate verifier. New child tables also invoke the shared deferred verifier.
do $$ declare d text; anchor text:='select * into strict s from private.sales where id=r.sale_id;'; begin
 d:=pg_get_functiondef('private.assert_refund_integrity()'::regprocedure);
 if strpos(d,anchor)=0 then raise exception 'REFUND_INTEGRITY_PATCH_PRECONDITION'; end if;
 execute replace(d,anchor,anchor||E'\n if r.scope=''PARTIAL'' then perform private.assert_partial_refund_integrity(rid); return null; end if;');
end $$;
do $$ declare n text; begin
 foreach n in array array['partial_refund_contexts','partial_refund_items'] loop
  execute format('create constraint trigger refund_reconciliation after insert on private.%I deferrable initially deferred for each row execute function private.assert_refund_integrity()',n);
 end loop;
end $$;

create function private.assert_refund_cumulative() returns trigger
language plpgsql security definer set search_path = '' as $$
declare r private.sale_refunds; sid uuid;
begin
 if tg_table_name='sale_refunds' then select * into strict r from private.sale_refunds where id=new.id;
 else select * into strict r from private.sale_refunds where id=new.refund_id; end if;
 sid:=r.sale_id;
 if (select coalesce(sum(total_won),0) from private.sale_refunds where sale_id=sid)>(select total_won from private.sales where id=sid)
  or exists(select 1 from private.sale_tenders o where o.sale_id=sid and
   (select coalesce(sum(t.amount_won),0) from private.refund_tenders t where t.original_tender_id=o.id)>o.settled_amount_won)
  or exists(select 1 from private.sale_cost_allocations o join private.sale_items i on i.id=o.sale_item_id where i.sale_id=sid and
   ((select coalesce(sum(a.quantity),0) from private.refund_allocations a where a.original_allocation_id=o.id)>o.quantity
    or (select coalesce(sum(a.total_cost_won),0) from private.refund_allocations a where a.original_allocation_id=o.id)>o.total_cost_won))
  or ((select count(*) from private.sale_refunds where sale_id=sid)>1 and exists(select 1 from private.sale_refunds where sale_id=sid and scope='FULL'))
 then raise exception 'REFUND_CUMULATIVE_LIMIT'; end if;
 return null;
end $$;
do $$ declare n text; begin
 foreach n in array array['sale_refunds','refund_tenders','refund_allocations'] loop
  execute format('create constraint trigger cumulative_reconciliation after insert on private.%I deferrable initially deferred for each row execute function private.assert_refund_cumulative()',n);
 end loop;
end $$;
revoke all on function private.refund_line_net(uuid),private.lock_refund_sale(),private.assert_partial_refund_integrity(uuid),private.assert_refund_cumulative() from public,campuspay_runtime;
insert into private.schema_migrations(version) values('20260920130000_partial_refund_ledger') on conflict do nothing;
