> **Canonical roadmap update — 20 September 2026:** CampusPay is being completed as a single production release with no planned V2. The authoritative final scope and definition of done are now in [PRODUCTION_COMPLETION_PLAN.md](PRODUCTION_COMPLETION_PLAN.md). This file is retained for historical gate context; where the two documents differ, the production completion plan governs.\n\n# CampusPay / MICA Money: v1.0 completion and release plan

Prepared 18 September 2026. Baseline: GitHub main `73470a2b9b0941a1e2533943e31ef7a03a7f74d2` (September 10). This plan separates implemented functions, fresh observations, proposed work, and release acceptance. It does not certify a public deployment or authorize destructive database cleanup.

## Target product and boundaries

A staffed, closed-loop school POS and a separately authenticated student online store, on distinct HTTPS origins, sharing one authoritative wallet/inventory/coupon/sales ledger. Staff use employee code and PIN. Students use their printed RFID/card number and PIN. E202 remains the physical enrollment/identity-handover point. East Building floor 2 rooms 201–206 are the initial delivery scope. West Building floors 2–4 remain non-orderable until actual rooms are provided. No guessed rooms or public self-registration.

Preserve the approved wallet floor of −₩15,000, card-first checkout, event-controlled cash/split tenders, server-side authorization, idempotency, restricted runtime database credentials, and Korea business dates. This is not a bank-card acquiring or parent payment-gateway project. Do not add an external payment processor, multiple wallets per checkout, offline settlement, or a microservice rewrite to launch scope.

## Already present: retain and test, not rebuild

Repository documentation and API metadata show staff roles; POS card/PIN checkout; wallet/cash/split tender controls; coupons; student enrollment; card/PIN replacement; costed inventory receipts/removal; FIFO/LIFO costing and COGS; financial reports and wallet history; online catalog and checkout; room delivery; fulfillment stages; authorization, session expiry and recovery; nonce CSP and host-specific protections; structured operational logging; migration preflight; and CI with build, unit, integration, and browser coverage.

This is a capability inventory, not fresh end-to-end certification. `docs/PRE_MERGE_HARDENING.md` explicitly leaves refunds, drawer reconciliation, historical pagination, real reader acceptance, E202 handover, and cash/change acceptance outside its previous pass. The package version remains 0.9.0 and is not a sufficient release identifier.

## Fresh observations on 18 September

Read-only inspection of CampusPay Neon project `late-cloud-92392600`, current main branch `br-late-bread-azrpu2xh`, database `campuspay`:

| Check | Observation | Meaning |
| --- | --- | --- |
| Migration history | 13 recorded migrations, ending `20260908110000_business_settlement_hardening` | More recent than the old local installer target. |
| Legacy target | September 7 installer embeds the endpoint for `legacy-main-pre-pr2-20260910` | Rerunning it can restore an incompatible database URL. |
| Runtime grants | All 15 new readiness-check API signatures exist and are executable; no direct access to any checked private table | Metadata/grant validation, not runtime-password authentication. |
| Wallets | 2 wallets; one at ₩20,000, one at ₩0; zero wallet ledger entries | The ₩20,000 wallet is the verified STU001 Demo Student bootstrap fixture. It is not journal-backed. |
| Sales and online orders | 0 sales and 0 online orders in current main | Zero reconciliation failures over zero rows is not transaction acceptance. |
| Inventory | 5 lots; no quantity/movement mismatches; no negative lots | Consistency of existing seeded lots only; not a physical stock count. |
| Audit categories | Demo bootstrap and local test enrollment events exist | Data is still demo/pilot material, not a clean production dataset. |
| Public hosting | Earlier inspection in this conversation found no CampusPay project in the connected Vercel team | Hosting elsewhere was not excluded; no public cutover is certified. |

`database/schema/010_demo_bootstrap.sql` inserts the ₩20,000 wallet directly without an opening ledger entry. Do not conceal this by blindly resetting the wallet or inventing a customer deposit. Historical schema scripts are not to be retroactively rewritten to repair live data.

## Gate 0 — local recovery and configuration discipline

**Delivered in this change:** secret-free repair command; protected, unique environment backup; main/legacy allowlist; password/pepper preservation; exact host/database pin; strong TLS setting; shell/Next development override detection; clean-main and fast-forward safety; sanitized failures; 15-capability runtime health check; regression tests; disposable PostgreSQL role smoke check in CI.

**Remaining acceptance:** user runs the package on the affected Mac; runtime password authenticates; both login surfaces load; a valid staff login and student login succeed against the intended environment. No remote tool can certify the Mac's hardware or local secrets without that run.

**Definition of done:** repaired config no longer targets legacy; repeat repair is idempotent; no secret changes; wrong branch and overprivileged credentials fail closed; no data migration occurs during startup. Attach exact commit/CI result and the password-free local health result.

## Gate 1 — establish a clean, auditable pilot/production baseline (P0)

**Work:** snapshot before any changes; classify the two existing student records, demo staff, seeded products/stock/coupons and test terminals; distinguish issued real cards from fixtures. Decide with the school whether to archive the current demo dataset as QA and initialize a clean production branch, or perform an approved, auditable in-place cleanup. Preserve the archive. Do not delete, rename, reset or move production data automatically.

Import real product prices, actual quantities, purchase cost/lot information, named staff roles, terminal identities, and authorized student roster. Real opening balances require approved source records and corresponding ledger entries, not direct balance updates. Disable or exclude demo accounts from live spending. Never rotate existing card/PIN peppers without a planned credential reissue/migration.

**Definition of done:** every active wallet reconciles to signed ledger entries and approved opening entries; inventory reconciles to physical opening stock and cost records; demo credentials cannot transact in the live environment; school owner signs off the opening position. The observed demo exception must be resolved or explicitly excluded before calling the dataset production-ready.

**Owner:** developer prepares scripts/rehearsal; school owner approves classification, opening balances and cutover. A new reviewed migration/operation must be rehearsed on an isolated copy before any live write.

## Gate 2 — transaction reversals and exception handling (P0)

**Build:** full-sale refund/reversal first, plus online cancellation before dispatch and a failed-delivery/returned-order path. A wallet adjustment by itself is not a refund because it does not reverse sales, COGS, coupon use and stock consistently.

Use new append-only refund/reversal records referencing the original sale and a unique idempotency key. Never delete or rewrite the original sale. Return funds to the original tender allocation; distinguish wallet credit from a physical cash payout. Enforce permissions, a reason, remaining-refundable limits, order state and replay safety. Restock only items actually returned in saleable condition; preserve original cost allocations and record waste/non-restockable returns separately. Coupon restoration/reissue must have an explicit policy rather than silently undoing redemption limits.

**Definition of done:** wallet-only, cash-only, split-tender and online reversals reconcile across ledger/tenders/sales/stock/COGS/audit. Duplicate and concurrent refund requests do not double-credit. Unauthorized staff and another student cannot refund the sale. Cancellation cannot race successfully with a completed dispatch. Two tabs, timeout, refresh and response-loss recovery return one authoritative result.

**Scope boundary:** partial line refunds may follow after the minimum full-sale reversal is reliable; no multi-wallet splits are required for v1.0.

## Gate 3 — daily operating controls (P0/P1)

**Build or complete:** terminal/shift opening float; expected cash from settled tenders minus actual cash payouts; counted denomination close; over/short variance with reason and reviewer; immutable closing record and export. Add account/terminal administration for staff activation/deactivation, roles, PIN reset, terminal labels/revocation and session revocation, rather than leaving live administration dependent on database-owner SQL. Retain existing elevated approval for student card/PIN replacement.

Add bounded/paginated sales, order, wallet and audit history with Korea-day filtering and export. Historical result limits must not silently omit older transactions during accounting/support. Include a daily reconciliation report covering wallet balances, tender totals, sale items/COGS, inventory movements, order-to-sale links and unsettled/unknown outcomes. Any zero-row check must identify its sample size.

**Definition of done:** an accountant closes a real test shift with wallet/cash/split purchases and refunds; report totals reconcile; inventory admin cannot view restricted wallet/sales reports; cashier cannot change roles or financial corrections; deactivated credentials and terminals lose access; history remains complete beyond one page.

## Gate 4 — store and fulfillment operability (P1, required for online launch)

**Build or complete:** operator-managed delivery locations and active/orderable status; school store open/closed switch and order cutoff; a clear closed/unavailable state; fulfillment exception reasons; delivery completion/return audit; persistent assignment or picking state when multiple employees work together. The existing local picking checkboxes are not synchronized between employees.

Start with the already-defined East rooms. Do not enable West floors until actual rooms are supplied. Keep one backend and the existing queue rather than adding a logistics system. Distinguish order creation from successful delivery; never use a manual status edit to conceal a failed financial reversal.

**Definition of done:** staff can close ordering without stopping authorized fulfillment; disabled rooms cannot receive new orders; double handling cannot silently duplicate dispatch; selected order/queue state survives ordinary refresh; students see authoritative status and the supported cancellation path; failed delivery can be reconciled through Gate 2.

## Gate 5 — production hosting, security and recoverability (P0)

**Configure:** a named, school-approved staff HTTPS origin and a distinct student-store HTTPS origin; host routing and origin checks; host-only secure HttpOnly cookies; restricted runtime connection in production; secrets through a controlled environment channel, never ZIPs, Git or client bundles. Owner/migration credentials must not be present in the application runtime. Preview/QA must never use the live production database.

Re-run exact-head dependency, unit, static, type, lint, build, integration and browser checks. Verify live host separation, wrong-origin rejection, cookie isolation, role separation, PIN/rate-limit behavior under the school's shared network, safe response headers and sanitized logs. Current dependency claims require current CI, not the old September 10 audit.

Set up health/error/latency monitoring and actionable alerts with an identified school/operator owner. Document network-outage behavior: do not claim payment success until the server confirms it; recover by idempotency/order history after reconnection. Offline financial settlement is out of scope.

Define recovery-point and recovery-time objectives with the owner. Verify the actual Neon retention configuration and test a restoration on an isolated branch. A named rollback branch is not a full backup policy. Preserve a pre-cutover snapshot, exact release commit and migration inventory; never roll a live wallet database back across settled transactions as a routine code rollback. Review school data access, minimization and retention obligations with the responsible administrator before public operation.

**Definition of done:** both real HTTPS origins work from school devices; cross-surface sessions fail; no live owner secrets or demo logins; alert routing is demonstrated; an isolated restore reconciles; an operator can follow rollback/incident instructions without developer improvisation.

## Gate 6 — physical acceptance, pilot and final sign-off (P0)

Run the complete journey: real E202 enrollment and card handover, scanner input including leading zeros/Enter behavior, PIN privacy, POS purchase, receipt, shared-stock online purchase, East-room picking/delivery, cancellation/refund, cash/change close, lost-card replacement and disabled-user denial. Include desktop, cashier touchscreen/tablet and student mobile layouts on the school's actual Wi-Fi.

Stress a documented expected school peak plus agreed headroom. Measure response times and zero duplicate settlement, oversell, lost wallet update or cross-student access under overlapping POS/store orders. Retest the −₩15,000 boundary, last-item races, coupon caps, Korea-midnight reports, cash-event expiry, session expiry during payment, and dropped responses. Use disposable data for destructive/chaos tests.

Run a supervised limited pilot, reconcile every operating day, and record issues/owners before expansion. Do not invent a reliability percentage or declare success from zero live transactions.

**Definition of done:** dated acceptance evidence signed by cashier, accountant, inventory/fulfillment lead, E202 enrollment lead and school owner; no open P0 defects; daily close and refund tests balance; hardware is accepted; recoverability is proven. Cut an identifiable v1.0 release with commit, migrations, deployment IDs, configuration profile and release notes. Keep a known-good installer independent of live secrets.

## Delivery order and scope control

Gate 0 → Gate 1 baseline → Gate 2 reversals → Gate 3 operating controls → Gate 4 delivery controls → Gate 5 deployment/recovery → Gate 6 pilot/sign-off. Infrastructure preparation can run alongside development, but live customer access waits for the data, security and financial gates. This is an execution order, not a promise of asynchronous work or a timeline estimate.

Defer loyalty gamification, native apps, external top-up gateways, multi-school tenancy, predictive analytics and a visual redesign unless a pilot demonstrates a concrete need. Preserve the existing architecture and tested settlement path.

## Evidence references

- `README.md`, `docs/PAYMENTS.md`, `docs/STUDENT_ENROLLMENT.md`, `docs/ONLINE_STORE.md` — existing product scope.
- `docs/PRE_MERGE_HARDENING.md` — prior verification and explicitly deferred work.
- `database/schema/010_demo_bootstrap.sql` — origin of unjournaled demo wallet balance.
- `.github/workflows/validate.yml` — exact required checks.
- `docs/LOCAL_RECOVERY.md` — repair usage, safety and limitations.
- Live Neon read-only inspection on 18 September 2026 — aggregate observations above; no live data changed.
