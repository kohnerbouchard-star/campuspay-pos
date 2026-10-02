-- Extend the existing reconciliation contract without copying or weakening its checks.
-- No receipt or financial journal is modified by this migration.
do $receipt_checks$
declare definition text; anchor text := '  union all select ''SALE_TENDERS'''; extra text := $checks$
  union all select 'RECEIPT_COSTS','Receipt header costs match their line totals',count(*),count(*) filter(where
   r.purchase_subtotal_won<>coalesce((select sum(l.base_cost_won) from private.stock_receipt_lines l where l.receipt_id=r.id),0)
   or r.total_landed_cost_won<>coalesce((select sum(l.total_landed_cost_won) from private.stock_receipt_lines l where l.receipt_id=r.id),0))
   from private.stock_receipts r
  union all select 'LOT_RECEIPT_COSTS','Received lot costs match receipt-line allocations',count(*),count(*) filter(where
   l.quantity_received<>rl.quantity or l.landed_unit_cost_won<>round(rl.total_landed_cost_won::numeric/rl.quantity,6))
   from private.inventory_lots l join private.stock_receipt_lines rl on rl.id=l.receipt_line_id
$checks$;
begin
 definition:=pg_get_functiondef('private.daily_reconciliation_document(date)'::regprocedure);
 if (length(definition)-length(replace(definition,anchor,'')))/length(anchor)<>1
  or position('RECEIPT_COSTS' in definition)>0 then raise exception 'RECONCILIATION_CONTRACT_MISMATCH'; end if;
 execute replace(definition,anchor,extra||anchor);
end;
$receipt_checks$;

-- A checksum is recorded only for migrations actually executed by the upgraded runner.
-- Historical NULL values are explicitly unverified; never backfill them from filenames.
alter table private.schema_migrations add column if not exists checksum_sha256 text
 check(checksum_sha256 is null or checksum_sha256 ~ '^[a-f0-9]{64}$');
insert into private.schema_migrations(version) values('20261002042000_receipt_reconciliation') on conflict do nothing;
