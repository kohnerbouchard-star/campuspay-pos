-- Separate PL/pgSQL loop records from SQL source aliases. No financial writes.
do $$ declare definition text; begin
 definition:=pg_get_functiondef('private.partial_refund_plan(uuid,jsonb)'::regprocedure);
 if strpos(definition,'a record; i record;')=0 then raise exception 'PARTIAL_PLAN_ALIAS_PATCH_PRECONDITION'; end if;
 definition:=replace(definition,'a record; i record;','v_allocation record; v_item record;');
 definition:=replace(definition,'into a from private.sale_cost_allocations','into v_allocation from private.sale_cost_allocations');
 definition:=replace(definition,'if not found or a.sale_id','if not found or v_allocation.sale_id');
 definition:=replace(definition,'original_allocation_id=a.id','original_allocation_id=v_allocation.id');
 definition:=replace(definition,'used+nr+nw>a.quantity','used+nr+nw>v_allocation.quantity');
 definition:=replace(definition,'a.expiration_date','v_allocation.expiration_date');
 definition:=replace(definition,'''original_allocation_id'',a.id,''sale_item_id'',a.sale_item_id','''original_allocation_id'',v_allocation.id,''sale_item_id'',v_allocation.sale_item_id');
 definition:=replace(definition,'''inventory_lot_id'',a.inventory_lot_id','''inventory_lot_id'',v_allocation.inventory_lot_id');
 definition:=replace(definition,'a.total_cost_won,a.quantity','v_allocation.total_cost_won,v_allocation.quantity');
 definition:=replace(definition,'for i in select * from private.sale_items','for v_item in select * from private.sale_items');
 definition:=replace(definition,'where value->>''sale_item_id''=i.id::text','where value->>''sale_item_id''=v_item.id::text');
 definition:=replace(definition,'where c.sale_item_id=i.id;','where c.sale_item_id=v_item.id;');
 definition:=replace(definition,'private.refund_line_net(i.id)','private.refund_line_net(v_item.id)');
 definition:=replace(definition,'(net,i.quantity,used,nr+nw)','(net,v_item.quantity,used,nr+nw)');
 definition:=replace(definition,'''sale_item_id'',i.id,''product_name'',i.product_name_snapshot','''sale_item_id'',v_item.id,''product_name'',v_item.product_name_snapshot');
 execute definition;
 definition:=pg_get_functiondef('private.assert_partial_refund_integrity(uuid)'::regprocedure);
 if strpos(definition,'join private.sale_items i on i.id=o.sale_item_id where x.refund_id=r.id')=0 then raise exception 'PARTIAL_INTEGRITY_ALIAS_PATCH_PRECONDITION'; end if;
 definition:=replace(definition,'o.inventory_lot_id,i.sale_id','o.inventory_lot_id,source_line.sale_id');
 definition:=replace(definition,'join private.sale_items i on i.id=o.sale_item_id where x.refund_id=r.id','join private.sale_items source_line on source_line.id=o.sale_item_id where x.refund_id=r.id');
 execute definition;
end $$;
insert into private.schema_migrations(version) values('20260920133000_partial_refund_sql_names') on conflict do nothing;
