# Full-sale refunds and pre-dispatch cancellation (Gate 2A)

This stage adds a staff-only full-sale reversal engine, a Refunds workspace, explicit cash-handover recording, opaque-response recovery, and Korea-day net reconciliation. It does not complete the whole launch plan. In particular, dispatched/failed-delivery/returned orders require Gate 2B, and cash drawer close, full history export and operator reassignment require Gate 3.

## Posting and accounting

Only Super Admin may post a refund. Accountants may inspect originals, refunds and the aggregate report; inventory staff, cashiers and customers may not post refunds. Existing role/session/origin protections remain enforced at the API and database boundaries. Find the exact original receipt, online order number or sale UUID. Verify the customer and each entire item's disposition. Partial refunds and arbitrary credit amounts are rejected.

A new immutable refund references one original sale. A unique sale constraint prevents two refunds, even with different request keys or operators. Original sale, tender, item, cost-allocation, coupon and payment ledger records are not rewritten. The wallet portion is credited to the same student's current wallet, never reset to the historical balance. The cash portion is a cash liability, not a wallet credit and not an assertion that cash was handed over. Refund only the actual settled amount, including any discount, and exclude original cash change.

Each original cost allocation is copied exactly, including its stored rounded cost; current product prices or a newly recomputed unit cost do not determine the refund. RESTOCK increases the original lot and appends SALE_REVERSAL movements only for goods physically verified saleable; an expired lot cannot be restocked. WRITE_OFF leaves physical stock unchanged and records the original cost as a separate refund loss. Original sale COGS is reversed, with that loss subtracted in the net-margin report. Do not claim damaged or missing goods were physically restocked. Coupon policy is explicitly KEEP_REDEMPTION: original coupon usage and allowances are not automatically restored or reissued.

Cancellation of an online sale requires PLACED, PICKING or READY under the same order-row lock used by dispatch. Successful cancellation and the financial reversal commit together with a CANCELLED status event. A dispatch/cancellation race cannot both succeed. OUT_FOR_DELIVERY, DELIVERED and already-closed orders are denied; do not relabel a failed delivery as pre-dispatch cancellation. No student self-service cancellation is introduced in this stage.

## Cash handover

A committed reversal shows cash still due. Only the original refund operator, using the original terminal, may record that the exact cash amount was handed over once. The payout record is append-only and unique per refund. Replays cannot create a second payout record, even using a different key. Amount and handover-reference checks remain server-side. Recording an already-authorized handover remains available during a new-refund shutdown.

Software does not dispense cash and cannot prove an unobserved physical handover. Two browser tabs or a lost response must never prompt a second physical payment. The UI explicitly separates posting, physical handover, and recording the handover. After an unconfirmed payout-record response, refresh the original refund's authoritative status. If cash was handed over but not recorded, record that existing handover rather than paying again. Uncertain handovers require manual operator reconciliation. Operator absence, another terminal, drawer integration and supervisor reassignment are not solved here and remain launch gates.

## Response loss and integrity

Before posting, sessionStorage must persist and read back only the sale UUID and request UUID. It never contains customer names, amounts, notes, card inputs, PINs, or the request body. A lost/malformed response blocks a new posting and restores the recovery action after reload. Recovery works for a fresh session of the original operator even when posting is disabled. It returns the original committed refund or closes a missing request under the same request lock; a late original cannot post after that closure. A different operator cannot recover or close the key.

Deferred database reconciliation validates every refund's full tender total and original cost-allocation coverage, wallet ledger linkage, restock movements and cash payout amount/operator/terminal. Failure of any journal or audit write rolls back the entire posting. Constraints and append-only triggers are not disabled to make tests pass. The refund engine uses the wallet/product/lot ordering of the existing settlement path. Deadlocks, transport failures or unknown errors are unconfirmed outcomes, never success.

## Reporting

Original sales reports remain original gross-sale registers and are labelled as before-refund totals with a link to Refunds. The new aggregate report includes all matching records without an artificial row cap. Original sales are included on their sale date, refunds on their posting date, and actual cash payout records on their handover-record date, all explicitly Asia/Seoul. Cash liability at the selected period end includes older refunds unpaid as of that boundary. Net margin = gross sales − refunds − original COGS + reversed COGS − write-off losses. This report is not a cash drawer close or a complete accounting ledger certification.

## Activation and release boundary

Migration `20260918150000_sale_refunds` and source module `024_sale_refunds.sql` are identical. It is additive, applies no refunds, and creates no cards, PINs, balances, inventory fixtures or demo cleanup. New posting requires both server environment REFUNDS_ENABLED=true and private.system_settings.refunds_enabled=true. Both default to off. The application runtime cannot change the database setting. Reviewed activation, school cash procedures and opening-data cleanup are required separately. Keep the real roster untouched and existing ROSTER_ISSUANCE_ENABLED unset/false.

The older enrollment migration in main is not yet installed on live Neon. Production rollout must use the ordered preflight/migration procedure, not run this migration alone out of sequence. No public deployment, live refund, cash payout, physical return or demo deletion is authorized by CI execution. All mutation tests use a uniquely named disposable localhost database and synthetic data. Exact commit, CI results and live read-only verification belong in the PR handoff.
