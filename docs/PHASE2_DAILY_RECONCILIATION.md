# Daily reconciliation workspace

This is a read-only operating report under production roadmap Phase 2. It does not change balances, close a business day, approve a cash variance, certify physical stock, activate features or declare production ready.

## What is available

Accountants and Super Admin can open `/reconciliation` from the workspace navigation or Reports. Select a Korea business date to see original sales and discounts, refunds posted, net sales and COGS, return write-off expense, wallet tender and funding movements, cash receipts/handovers, drawer closes, signed inventory movement values, online-order status events and currently unresolved requests. Export produces a CSV of every metric and check, including the business date and report-generation timestamp.

The report includes eleven current cross-journal checks: wallet balances against cumulative journals; wallet entry arithmetic; physical lot quantities against movement journals; sale-to-tender totals; sale item quantities/costs against allocations; refund values and cost dispositions; cumulative refund values; cumulative returned allocation quantities/costs; drawer closes against cash events; funding receipt journal links; and online order/sale/student links. Each check shows its denominator and discrepancy count. These checks cover recorded relationships, not every conceivable financial-control failure.

All metrics and checks are read in one database-statement snapshot after authorization. A later export is a fresh snapshot, so retain its timestamp. A clear result means only that these automated checks found no discrepancy. A report with no posted activity is never labelled evidence of a successful operating day. Existing unexplained/demo opening balances remain visible as discrepancies; no compensating transactions are fabricated.

## Accounting scope is explicit

Sales use settlement dates. Refunds use refund-posting dates, including refunds for older sales; those can make the selected day's net sales negative. Cash payouts use the date the handover was recorded, not the refund approval date. Outstanding cash refunds at day end are separately calculated using both approval and payout timestamps.

Wallet opening/closing positions are reconstructed from journal entries. Positive prepaid balances and student debt are presented separately rather than netting debt into an apparent prepaid liability. Current stored-wallet checks must be resolved before treating reconstructed positions as an approved baseline. All wallet increases/decreases and other/legacy movement are shown so this report does not hide the earlier adjustment workflow.

Inventory opening and ending values are signed movement-journal carrying values, not a new valuation using today's product price. The report shows receiving, sale COGS, saleable restock and other signed adjustments. Fractional unit-cost rounding can create a difference from a separate physical quantity-times-unit-cost valuation; the current quantity reconciliation does not claim to prove those valuations identical. Returned items written off are reported as expenses, not inventory added.

Cash-flow metrics exclude opening floats. Drawer-close metrics select the close date and can include movements from earlier days. Current open drawers, order queues, pending requests and still-unreviewed variances are explicitly marked current, not falsely reconstructed as historical statuses. A prepared or expired request awaiting closure does not demonstrate that a payment settled. Operators must recover uncertain requests before repeating financial actions.

## Access and rollout

The page and both report/export APIs require `reports.sales`; database authorization independently enforces that permission. The private report helper is not executable by the runtime role. Student sessions, cashiers and inventory-only staff cannot read this financial workspace. The dedicated store surface excludes the staff page and API routes. Report responses are private and not cached.

Forward-only schema/migration pair 039 introduces the report. Prior migrations remain unchanged. A database upgrade is needed before this UI is available on a deployment using the earlier schema. No production migration, data cleanup, credentials or feature activation is performed by this repository change.

This workspace is not the entire remaining reporting roadmap: complete sales/order/inventory/audit registers and their exports, product/category analysis, source-evidence review and final day-close sign-off retain their own outstanding requirements.

## Focused verification

One isolated mixed-day acceptance scenario records a cash wallet deposit with change, a split POS sale, an online wallet order, a partial item refund, its explicit cash handover and an exact drawer close through authenticated APIs. Expected sales, wallet, cash and order amounts are independently stated and compared with the report. All journal checks except the intentionally retained demo opening-balance mismatch must be clear. Report/export reads leave financial digests unchanged. Role denials, invalid dates, complete export and four browser widths are covered. The existing settlement, funding, scanner and history suites remain enabled. Actual CI outcomes are recorded in the PR, not assumed here.
