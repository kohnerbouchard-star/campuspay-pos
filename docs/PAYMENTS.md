# MICA Money payment operations

The register and online store share one inventory, costing and sales system. `sales.channel` remains `POS` or `ONLINE_STORE`. Payment tender is recorded separately in immutable `private.sale_tenders`: one wallet leg, one cash leg, or both. Each completed sale reconciles to its tender total with deferred PostgreSQL constraints; wallet tender also reconciles to the sale's wallet ledger entry. Cash received and change are stored separately from cash applied to revenue.

## Event cash

A Super Admin enables cash and split in **Payment settings** (`/settings/payments`). A named event and future end time within 24 hours are required. POS shows status and an administrator shortcut to that workspace. The policy applies to **this browser/register**, identified by its terminal cookie, and survives logout. A different browser profile starts with cash off. End times are actual timestamps, displayed in the device’s local timezone. New intents and atomic settlement both reject expired cash/split; wallet-only purchases remain available. Existing enabled events without an end time fail closed until reconfigured.

Policy changes audit actor, terminal, old/new state, event name, and end timestamp. Automatic expiry is derived from that audited timestamp and reported as `EXPIRED`; no background job writes an artificial staff action. The POS immediately removes Cash/Split at its known deadline and refreshes server policy every 15 seconds.

Cash-only sales require no student card, PIN or wallet. Coupons with a per-student use limit require a MICA Money payment; unrestricted coupons can be used for cash. No synthetic student or wallet activity is created for cash.

For split payment, choose **Split**, start payment, and scan the student’s card. The server shows the student, current balance, minimum balance, and maximum contribution for this sale. Choose **Use maximum MICA Money** or a smaller positive contribution below both the sale total and the authorized maximum. If the wallet can cover everything, **Switch to MICA Money** produces a wallet-only plan. Then enter cash received and the student PIN, review the amounts/change, and confirm once.

The draft uses a null wallet allocation until the card-bound plan is finalized. `finalize_payment_tender` is preparation only: it checks the same session, terminal policy, active bound card, unexpired intent, and current capacity, then binds one immutable amount. It cannot validate a PIN or write money, inventory, revenue, COGS, or coupon journals. Repeating the same plan is safe; changing it requires cancellation and a new intent. Final settlement rechecks every financial condition. Capacity is `min(sale total, max(0, balance − configured floor))`; the floor remains −₩15,000. Coupons discount the sale before tender allocation.

For example, a ₩12,000 total paid with ₩7,000 MICA Money and ₩5,000 cash, with ₩10,000 received, records ₩5,000 change and ₩12,000 revenue. Stock and COGS post once. If only ₩4,000 cash is available, nothing settles: no wallet debit, sale, stock consumption, coupon redemption or COGS entry.

## Workstation inactivity

The POS workstation locks after five minutes without interaction, warning in the
last 30 seconds with **Stay signed in**. Pointer, keyboard, and touch reset it.
A five-second activity heartbeat operates only while the workstation is active;
the database’s existing 20-second cashier session expiry is unchanged. Failed
expiry/revocation checks require sign-in and cannot be renewed by the browser.
Network suspension or background throttling may therefore require reauthentication.

Payment UI protection lasts through the server intent deadline plus a 30-second
result grace period; receipts and initial recovery have a bounded 60-second
lease. Completion or safe cancellation starts a fresh five-minute window.
The existing **two-minute payment intent** is not extended: an expired proposal
cannot settle, and the UI offers cancellation. Unknown outcomes retain recovery
instead of being described as failed. A stalled confirmation request times out
after 30 seconds and enters the same recovery flow. No abandoned flow renews its
protection merely by re-rendering.

## Interrupted confirmations

A pending POS intent ID is saved in this tab before confirmation, without card or PIN data. If confirmation is interrupted, keep the sale open or sign in again on the same register. **Recover payment result** waits for any in-flight transaction and either retrieves its receipt or cancels the uncommitted proposal. It never starts a second sale. The register blocks new payment activity until recovery completes. Known rejection says nothing was charged. An unknown result uses a distinct amber warning: **Do not start another transaction until this result is recovered.**

Wallet adjustments have equivalent same-register recovery. Online orders retain their reviewed proposal and request ID in session storage, bound to the student, so a response lost across reload or sign-in can be retried using the same request. Only the server's confirmed result changes the wallet shown as paid.

## Reports

Reports show completed sale revenue once, with independent channel and tender breakdowns. Cash received above the amount due never inflates revenue. Date ranges use Korea Standard Time. Transaction rows retain receipt, time, operator, student when applicable, revenue, tender amounts, cash received/change, COGS and gross profit.

Opening float, counted closing cash, drawer adjustments and reconciliation sessions are deferred. Tender records already retain terminal, event label and timestamps for a later drawer-reconciliation feature. Only cash tender will contribute to physical cash activity.

## Verification and rollout

Run `npm run build` followed by `npm run test:integration:isolated` for a fresh local test database, or `npm run test:visual` for the browser matrix. Both require an isolated local PostgreSQL server; `TEST_POSTGRES_URL` must use localhost. Never point test scripts at a school production database.

The feature's migrations were tested on the isolated Neon branch recorded in the delivery report. They have not been applied to production. Review the migrations and use the school's normal rollout process separately. Physical reader timing, card normalization and the printed-card number must be checked with actual school hardware before live enrollment.
