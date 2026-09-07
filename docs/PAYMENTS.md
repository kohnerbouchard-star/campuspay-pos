# MICA Money payment operations

The register and online store share one inventory, costing and sales system. `sales.channel` remains `POS` or `ONLINE_STORE`. Payment tender is recorded separately in immutable `private.sale_tenders`: one wallet leg, one cash leg, or both. Each completed sale reconciles to its tender total with deferred PostgreSQL constraints; wallet tender also reconciles to the sale's wallet ledger entry. Cash received and change are stored separately from cash applied to revenue.

## Event cash

A Super Admin can enable cash and split payments in **Payment settings** or the POS event settings. A named event is required. The setting applies to **this browser/register**, identified by the existing terminal cookie; it survives staff logout and remains on until a Super Admin disables it. A different browser profile starts with cash off. Policy changes record actor, terminal scope, prior/new state and event label in audit history. The checkout rechecks policy inside settlement.

Cash-only sales require no student card, PIN or wallet. Coupons with a per-student use limit require a MICA Money payment; unrestricted coupons can be used for cash. No synthetic student or wallet activity is created for cash.

For split payment, enter the amount the student wants to use from MICA Money. The remaining amount is due in cash. Scan the student's card, verify their PIN, enter cash received, and confirm the whole payment. The −₩15,000 wallet floor applies only to the wallet portion. Coupons discount the sale before tender allocation.

For example, a ₩12,000 total paid with ₩7,000 MICA Money and ₩5,000 cash, with ₩10,000 received, records ₩5,000 change and ₩12,000 revenue. Stock and COGS post once. If only ₩4,000 cash is available, nothing settles: no wallet debit, sale, stock consumption, coupon redemption or COGS entry.

## Interrupted confirmations

A pending POS intent ID is saved in this tab before confirmation, without card or PIN data. If confirmation is interrupted, keep the sale open or sign in again on the same register. **Recover payment result** waits for any in-flight transaction and either retrieves its receipt or cancels the uncommitted proposal. It never starts a second sale. The register blocks new payment activity until recovery completes.

Wallet adjustments have equivalent same-register recovery. Online orders retain their reviewed proposal and request ID in session storage, bound to the student, so a response lost across reload or sign-in can be retried using the same request. Only the server's confirmed result changes the wallet shown as paid.

## Reports

Reports show completed sale revenue once, with independent channel and tender breakdowns. Cash received above the amount due never inflates revenue. Date ranges use Korea Standard Time. Transaction rows retain receipt, time, operator, student when applicable, revenue, tender amounts, cash received/change, COGS and gross profit.

Opening float, counted closing cash, drawer adjustments and reconciliation sessions are deferred. Tender records already retain terminal, event label and timestamps for a later drawer-reconciliation feature. Only cash tender will contribute to physical cash activity.

## Verification and rollout

Run `npm run build` followed by `npm run test:integration:isolated` for a fresh local test database, or `npm run test:visual` for the browser matrix. Both require an isolated local PostgreSQL server; `TEST_POSTGRES_URL` must use localhost. Never point test scripts at a school production database.

The feature's migrations were tested on the isolated Neon branch recorded in the delivery report. They have not been applied to production. Review the migrations and use the school's normal rollout process separately. Physical reader timing, card normalization and the printed-card number must be checked with actual school hardware before live enrollment.
