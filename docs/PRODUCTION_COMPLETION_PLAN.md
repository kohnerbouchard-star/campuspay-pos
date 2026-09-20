# CampusPay / MICA Money — Production Completion Plan

**Status:** Authoritative final-production roadmap  
**Prepared:** 20 September 2026  
**Repository:** kohnerbouchard-star/campuspay-pos  
**Baseline main:** c3a32050a4cb9ad5c63d996783a95cda59f810c8  
**Release target:** one production-complete release; no planned V2

## 1. Purpose

CampusPay is not being developed as a thin v1 followed by a later V2. This document defines the complete production target for the system.

A feature is not considered finished merely because application code exists. The production definition of done requires the relevant code, database migrations, production configuration, operational procedures, data baseline, deployment, hardware acceptance, recovery procedures, and school sign-off.

If another planning document conflicts with this file, this file governs final product scope.

## 2. Non-negotiable production rules

The final release must satisfy all of the following:

- No known P0 or P1 production defects.
- No active demo/test credentials, demo wallets, demo cards, or unexplained demo balances in production.
- No unexplained wallet, cash, inventory, refund, order, or ledger discrepancies.
- No physical cash movement that bypasses a recorded cash event.
- No financial mutation that can become ambiguous after response loss.
- No required school workflow that depends on direct database-owner SQL.
- No required accounting/history workflow that silently truncates records.
- No preview or QA deployment using production database credentials.
- No owner/migration credentials in the application runtime.
- No bulk student card/PIN issuance during migration or roster import.
- Student enrollment remains deliberate and tied to an existing roster identity.
- Staff and student sessions remain separated by surface/origin.
- The existing negative wallet floor remains −₩15,000 unless the owner explicitly changes policy.
- West-building rooms remain unavailable until real room data is supplied.
- Existing transaction and journal history remains immutable; corrections are append-only.
- Production release must be identifiable by exact commit, migration inventory, deployment IDs, configuration profile, and acceptance evidence.

## 3. Completion state model

Every major capability should be tracked through these states:

1. **IMPLEMENTED_CODE** — code/migration exists.
2. **REPO_VERIFIED** — exact-head CI, integration, browser, security and migration checks pass.
3. **LIVE_MIGRATED** — production schema is current.
4. **PROD_CONFIGURED** — production settings, staff, terminals, products, rooms, secrets and feature gates are correct.
5. **PHYSICALLY_ACCEPTED** — real devices/network/operators pass acceptance.
6. **PRODUCTION_CERTIFIED** — evidence is recorded and no blocking defects remain.

A capability is not “done” until its required final state is reached.

## 4. Already delivered in the repository

The following major capabilities already exist in current main and should be preserved rather than rebuilt:

- Staff authentication and role-separated workspaces.
- Student store authentication.
- Shared wallet/inventory/coupon/accounting backend.
- Card-first + PIN POS checkout.
- Wallet, cash and split-tender settlement.
- −₩15,000 wallet floor.
- Costed inventory lots, allocation and COGS.
- Coupon validity, caps and redemption controls.
- Online ordering and room-delivery workflow.
- 135-student school roster with Year and academic-year metadata.
- Existing-roster deliberate enrollment workflow, default-off for live issuance.
- Full-sale refunds and cancellation.
- Post-dispatch/failed-delivery inspected returns.
- Cash shift opening, closing, denomination count and variance review.
- Staff/terminal administration.
- Response-loss recovery patterns across high-risk operations.
- Existing responsive browser/integration test suite.
- Administration lock-order and stale-editor hardening.

These are foundations for the final product, not justification to skip the remaining production work.

---

# Phase 0 — Final scope, tracker and repository hygiene

## Build / update

- Make this file the canonical production roadmap.
- Keep docs/V1_LAUNCH_PLAN.md as historical gate context, but have it defer to this document.
- Update issue #4 to be the master Production Completion tracker.
- Reconcile stale issue #9 against already merged refund/return work and close it when its acceptance items are mapped.
- Keep issue #5 open until production demo/test cleanup and opening-position reconciliation are actually complete.
- Track every remaining feature under a production phase rather than “V2”.
- Record explicit non-goals to prevent uncontrolled scope growth.

## Definition of done

- One canonical roadmap.
- No duplicate/conflicting launch checklists.
- Open issues accurately represent current work.
- Every future PR states which production phase and acceptance items it advances.

---

# Phase 1 — Complete the financial transaction model

## 1.1 Partial refunds and partial returns

Production must support real-world item-level corrections, not only full-sale reversal.

Implement:

- Refund by sale line.
- Refund quantity less than original quantity.
- Multiple partial refunds against one sale.
- Remaining-refundable quantity and value.
- Item-level return disposition.
- Original tender allocation preservation.
- Correct split-tender refund allocation.
- Original-cost COGS reversal.
- Original inventory lot restoration.
- RESTOCK / DAMAGED / WRITE_OFF disposition.
- Explicit coupon treatment.
- Immutable refund/return records.
- Idempotent response-loss recovery.
- Concurrent refund/return protection.

Required invariants:

- Total refunded value must never exceed original settled value.
- Total returned quantity must never exceed original sold quantity.
- Original sale/tender/COGS journals remain immutable.
- A duplicate or retried request must never double-credit or double-restock.

## 1.2 Complete wallet funding lifecycle

Add production-safe wallet funding and correction workflows:

- Cash wallet deposit.
- Approved administrative wallet credit.
- Approved administrative wallet debit/correction.
- Mistaken-deposit reversal.
- Source/reference.
- Reason.
- Operator.
- Terminal.
- Cash shift where applicable.
- Immutable wallet ledger entry.
- Receipt/reference.
- Elevated approval for high-risk corrections.

No wallet balance may change without a corresponding ledger event.

## 1.3 Complete physical cash lifecycle

Cash-drawer accounting must include every supported physical movement:

- Opening float.
- Cash sale.
- Cash refund payout.
- Cash-funded wallet deposit.
- Paid-in.
- Paid-out.
- Cash drop.
- Drawer transfer only if the school actually uses transfers.
- Closing count.
- Variance.

Core equation:

**Expected Cash = Opening Float + Recorded Cash In − Recorded Cash Out**

No employee should use an unrecorded workaround for physical cash movement.

## 1.4 Unified financial recovery model

All financial mutations should converge on the same behavior:

- Unique opaque request ID.
- Idempotent replay.
- PENDING / COMMITTED / REJECTED-or-CLOSED result.
- Response-loss recovery.
- Actor and terminal attribution.
- Immutable audit record.
- No replay of raw payment/card/PIN secrets.
- Recovery can close a genuinely missing request so delayed execution cannot later mutate money.

## Acceptance

- Wallet-only, cash-only and split transactions reconcile.
- Full and partial refunds reconcile.
- Wallet deposits reconcile to both wallet liability and cash drawer where applicable.
- Duplicate, concurrent and response-loss tests prove exact-once financial effect.
- No financial operation can produce an unexplained balance.

---

# Phase 2 — Complete accounting, history and reconciliation

## 2.1 Remove historical truncation

Replace fixed-history limits with real pagination/filtering for:

- Sales.
- Refunds/returns.
- Wallet ledger.
- Cash shifts.
- Cash events.
- Wallet deposits/corrections.
- Inventory movement.
- Online orders.
- Audit events.
- Coupons/redemptions.
- Enrollment/card/PIN lifecycle.

Support:

- Cursor or deterministic page pagination.
- Date range.
- Student.
- Employee.
- Terminal.
- Tender type.
- Transaction type.
- Status.
- Order.
- Receipt/reference.

No accounting/support screen may silently stop at the most recent N rows.

## 2.2 Complete exports

Provide:

- Export current page.
- Export current filtered result set.
- Export complete selected date range.

Exports must not silently truncate. CSV is sufficient.

## 2.3 Daily reconciliation workspace

Build a dedicated reconciliation view for each Korea business date.

### Sales

- Gross sales.
- Discounts.
- Refunds.
- Net sales.

### Tender

- Wallet tender.
- Cash tender.
- Split allocation.
- Cash refunds.
- Wallet refunds.
- Wallet deposits.

### Wallet liability

- Opening liability.
- Deposits/credits.
- Spending.
- Refund credits.
- Corrections.
- Closing liability.

### Cash

- Opening floats.
- Cash receipts.
- Cash deposits.
- Refund payouts.
- Paid-outs/drops.
- Expected closing cash.
- Actual closing cash.
- Variance.

### Inventory

- Opening inventory value.
- Receipts.
- COGS.
- Returned stock.
- Write-offs.
- Adjustments.
- Closing inventory value.

### Orders

- Created.
- Cancelled.
- Delivered.
- Failed.
- Returned.
- Unresolved.

### Required invariant checks

- Wallet balances equal cumulative ledger effects.
- Inventory lot quantities equal inventory movement history.
- Cash expected equals recorded shift cash events.
- Sale totals equal tender allocations.
- Refund totals equal refund tender allocations.
- Order-linked sale/refund states are internally consistent.
- Unknown/pending recoveries are enumerated, not hidden.

A reconciliation failure should appear as a blocking exception, not merely as a number in a report.

## 2.4 Operational reports

Production should include:

- Sales report.
- Product/category sales report.
- Gross-margin report.
- COGS report.
- Inventory valuation.
- Stock movement.
- Wallet liability.
- Wallet deposit/correction report.
- Refund/return report.
- Coupon/redemption report.
- Cash shift report.
- Cash variance report.
- Online order/fulfillment report.
- Staff activity report.
- Audit history.

## Acceptance

- History remains complete beyond one page.
- Date-filtered exports reconcile to on-screen totals.
- Accountant can close a realistic test day with wallet/cash/split sales, deposits and refunds.
- Role restrictions prevent unauthorized access to financial reports.
- Every displayed aggregate states its date/filter scope.

---

# Phase 3 — Complete inventory and product operations

## 3.1 Product management

Authorized staff can:

- Create product.
- Edit product.
- Activate/deactivate.
- Archive discontinued product.
- Change selling price.
- Assign category.
- Set POS availability.
- Set online-store availability.
- Set display order.
- Mark unavailable/sold out.
- Manage product image if the production UX uses images.

Historical sales retain historical product/price information.

## 3.2 Inventory receiving and adjustment

Support:

- Receive stock.
- Quantity.
- Unit purchase cost.
- Supplier/reference.
- Lot/receipt date.
- Expiry where relevant.
- FIFO/LIFO policy as already supported.
- Damage.
- Waste.
- Correction.
- Inventory adjustment reason.
- Approval for sensitive adjustments.
- Full movement history.

## 3.3 Physical stocktake

Implement a formal count workflow:

**Expected → Counted → Variance → Reason → Approval → Adjustment journal**

No stocktake should rewrite history.

## 3.4 Availability controls

Add:

- Low-stock threshold.
- Out-of-stock state.
- Negative-stock prevention.
- Low-stock dashboard/warning.
- Shared authoritative stock between POS and store.

## Acceptance

- Stock cannot go negative through concurrent POS/store orders.
- Stocktake variances create explicit immutable adjustments.
- Product price changes do not alter historical receipts.
- Deactivated products cannot be newly sold but remain visible in history.

---

# Phase 4 — Complete online store and fulfillment

## 4.1 Store administration

Implement:

- Store open/closed.
- Scheduled opening hours if the school wants scheduling.
- Emergency close.
- Daily order cutoff.
- Closure message.
- Authorized fulfillment while ordering is closed.

## 4.2 Delivery-location administration

Represent:

- Building.
- Floor.
- Room.
- Active/inactive.
- Orderable/non-orderable.
- Display order.

Initial production location set:

- East Building floor 2.
- Rooms 201–206.

Do not invent or enable West-building rooms without actual room data.

## 4.3 Authoritative fulfillment state

Use a server-authoritative workflow such as:

NEW → ACCEPTED → PICKING → READY → OUT_FOR_DELIVERY → DELIVERED

Terminal alternatives:

- CANCELLED.
- FAILED_DELIVERY.
- RETURNED.

Persist:

- Assigned employee.
- Assignment timestamp.
- Picked state/quantity.
- Delivery employee.
- Exception note/reason.
- Reassignment history.

Two employees must not silently fulfill the same order.

## 4.4 Fulfillment exceptions

Support:

- Item unavailable.
- Student/customer unavailable.
- Invalid room.
- Delivery refused.
- Damaged item.
- Failed delivery.
- Cancellation before dispatch.

Every exception must connect to the correct financial/inventory outcome.

## Acceptance

- Closing the store blocks new orders without blocking authorized fulfillment.
- Disabled rooms cannot receive new orders.
- Assignment/picking survives refresh and is shared across employees.
- Double handling is prevented or surfaced.
- Failed delivery reconciles through the return/refund system.
- Student-facing status is authoritative.

---

# Phase 5 — Complete student lifecycle

## 5.1 Enrollment

Preserve the current model:

**Roster → E202 identity verification → deliberate card issuance → private PIN**

No automatic card or PIN issuance from roster import.

The current 135 roster students remain unissued until separately authorized.

## 5.2 Card lifecycle

Support:

- Initial issuance.
- Lost card.
- Stolen card.
- Damaged card.
- Deactivate.
- Replace.
- Old-card revocation.
- Session revocation.
- Preserved wallet/history.
- Immutable card lifecycle audit.

## 5.3 PIN lifecycle

Support:

- Initial PIN.
- Failed-attempt lockout.
- Administrative reset.
- Student change workflow if adopted.
- Session revocation after reset.
- No PIN disclosure.

## 5.4 Student account state

Support at minimum:

- Active.
- Suspended.
- Withdrawn.
- Graduated.
- Archived.

Inactive identities cannot transact but remain queryable for accounting/history.

## 5.5 Academic-year rollover

This is part of the permanent product because no V2 is planned.

Controlled rollover must support:

- Y6 → Y7.
- Y7 → Y8.
- Y8 → Y9.
- Y9 → Y10.
- Y10 → Y11.
- Y11 → Y12.
- Y12 → Graduated.
- Incoming student import.
- Permanent student IDs unchanged.
- Wallet/history preserved.
- Cards preserved unless policy says otherwise.
- Academic-year updated.
- Pre/post-rollover verification report.
- Individual exceptions such as repeating year, withdrawal or late enrollment.

## Acceptance

- Duplicate names remain distinguishable through stable ID/Year.
- Card replacement never creates a new wallet/student.
- Disabled/withdrawn students cannot spend.
- Rollover preserves all financial history and wallet balances.

---

# Phase 6 — Complete staff, roles and terminals

The administration feature exists; this phase takes it to live operating status.

## 6.1 Real staff provisioning

Provision actual named employees and remove demo operational access.

Supported roles remain:

- Cashier.
- Inventory Admin.
- Accountant.
- Super Admin.

Keep least privilege.

## 6.2 Staff lifecycle

Production workflows must cover:

- Create.
- Activate.
- Deactivate.
- Role change.
- PIN reset.
- Session revocation.
- Audit history.

## 6.3 Terminal lifecycle

Each production workstation/device needs:

- Stable terminal ID.
- Human-readable label.
- Active/inactive.
- Session revocation.
- Last-used visibility.
- Location if useful.
- Open-drawer protection.

Suggested examples:

- E202 Enrollment.
- Student Store Register 1.
- Student Store Register 2.

## 6.4 Lost/replaced terminal procedure

Document and test:

- Deactivate terminal.
- Revoke sessions.
- Resolve/open cash shift.
- Register replacement.
- Confirm old terminal cannot authenticate.

## Acceptance

- No administration task requires direct database SQL.
- Deactivated staff/terminal access ends immediately.
- Last Super Admin protections remain.
- Open-shift guards remain.
- Self-lockout protections remain.

---

# Phase 7 — Establish a clean production data baseline

This is the existing P0 cleanup/opening-position work.

## 7.1 Preserve before changing

Create:

- Immutable snapshot/archive.
- Pre-cutover Neon branch/snapshot.
- Export of relevant opening data.
- Exact migration inventory.
- Exact release commit reference.

## 7.2 Classify every live object

Classify as REAL or DEMO/TEST:

- Students.
- Staff.
- Cards.
- PIN credentials.
- Wallets.
- Wallet balances.
- Terminals.
- Products.
- Coupons.
- Stock lots.
- Inventory movements.
- Audit records.

## 7.3 Remove operational demo access

Production must contain no active demo login capable of:

- Staff authentication.
- Student-store authentication.
- Card spending.
- Coupon use.
- Terminal operation.

## 7.4 Opening financial position

Every real nonzero balance requires owner-approved source evidence.

For the 135 real roster students, preserve the intended ₩0 opening state unless explicitly funded later.

Resolve the known demo/bootstrap ₩20,000 separately. Do not create fake real-student deposit history just to make the dataset look cleaner.

## 7.5 Opening inventory

Before launch:

- Count physical inventory.
- Enter approved quantities.
- Enter actual purchase cost.
- Reconcile system quantity/value to physical stock.
- Record sign-off.

## Acceptance

- No active demo credentials.
- No unexplained wallet balance.
- Wallet/ledger opening position is understood.
- Inventory/movement opening position reconciles.
- Owner signs off before live financial activity.

---

# Phase 8 — Bring production database fully current

The current live database must be compared against repository migrations immediately before execution; do not rely on an old inventory.

## Procedure

1. Confirm exact main/release-candidate commit.
2. Enumerate repository migrations.
3. Enumerate live production migrations.
4. Establish isolated staging/QA.
5. Rehearse every missing migration in exact order.
6. Run migration preflight.
7. Run migration.
8. Run post-migration schema/API/grant verification.
9. Run full integration/browser suite against the migrated staging shape.
10. Run financial/data invariants.
11. Rehearse recovery/rollback.
12. Apply the identical reviewed migration set to production.
13. Re-run post-migration verification.
14. Record final migration inventory.

Previously published migrations are never edited to “fix” production. Use forward-only remediation.

## Acceptance

**Repository migration inventory = production migration inventory**

and every required production RPC/schema capability passes.

---

# Phase 9 — Production architecture and hosting

Preserve the separated-surface architecture.

## Staff surface

Example:

**pos.school-domain**

## Student surface

Example:

**store.school-domain**

They may share the same backend/database while retaining strict session/origin isolation.

## Production controls

Configure and verify:

- HTTPS.
- Secure host-only HttpOnly cookies.
- Production CSP.
- HSTS.
- Permissions policy.
- Origin enforcement.
- Mutation origin checks.
- Rate limiting.
- Authentication throttling.
- Sanitized application errors.
- Sanitized logs.
- Environment-specific feature gates.
- Separate production/preview/QA configuration.

## Secrets

Production runtime must not contain:

- Database owner credentials.
- Migration credentials.
- Raw PIN/card values.
- Development secrets.

Use only restricted runtime credentials.

Preview and QA must never share production database credentials.

## Acceptance

- Staff URL cannot use student session.
- Store URL cannot use staff session.
- Wrong-origin mutation requests fail.
- Runtime has no direct private-table mutation access outside reviewed APIs.
- No secrets appear in browser bundles or logs.

---

# Phase 10 — Repository and release security

## Delivery controls

- Avoid casual direct commits to main.
- Require or operationally enforce validation before production merge.
- Use the strongest private-repository branch controls available on the selected GitHub plan.
- If plan limitations prevent a desired ruleset, document the manual release control rather than making the repository public.
- Exact commit SHA identifies each production deployment.
- Lockfile remains committed.
- Dependency vulnerability scan passes.
- Production build is reproducible.
- Release tags are immutable operating references.

## Acceptance

No production deployment is identified merely as “latest main.”

Every release maps to an exact reviewed commit and completed validation record.

---

# Phase 11 — Monitoring, backups and incident recovery

## 11.1 Monitoring

At minimum monitor:

- Application availability.
- 5xx rate.
- Authentication failures.
- Transaction failures.
- Database connection failures.
- Latency.
- Unresolved recovery requests.
- Wallet reconciliation failures.
- Cash reconciliation failures.
- Inventory reconciliation failures.

## 11.2 Alerts

Define:

- Operational owner.
- Technical escalation.
- Financial discrepancy escalation.

Demonstrate that alerts reach a real person.

## 11.3 Database recovery

Verify actual Neon retention/backups.

Define:

- Recovery Point Objective.
- Recovery Time Objective.
- Restore procedure.
- Code rollback procedure.
- Migration recovery procedure.

Perform an isolated restore test and reconcile the restored database.

Never routinely roll a financial database backward across legitimate settled transactions just because application code rolled back.

## 11.4 Kill switches

Retain narrowly scoped emergency controls for high-risk posting such as:

- Refunds.
- Returns.
- Cash posting.
- Card issuance.
- Administration.

Required close/recovery operations must remain possible where appropriate.

## Acceptance

- Alert path demonstrated.
- Isolated restore demonstrated.
- Operator can follow the runbook without developer improvisation.
- Exact pre-cutover backup/snapshot recorded.

---

# Phase 12 — Complete automated acceptance

The final CI/acceptance matrix should cover at least:

- Wallet-only sale.
- Cash-only sale.
- Split sale.
- Cash wallet deposit.
- Full refund.
- Partial refund.
- Full return.
- Partial return.
- Coupon.
- Last-item race.
- Insufficient wallet.
- −₩15,000 floor.
- Concurrent POS/store purchase.
- Stock race.
- Refund race.
- Return race.
- Cancellation/dispatch race.
- Drawer-close/payment race.
- Duplicate request.
- Response loss.
- Session expiration.
- PIN lockout.
- Disabled employee.
- Disabled terminal.
- Lost card.
- Replacement card.
- Duplicate student names.
- Korea-midnight reporting.
- Store cutoff.
- Closed store.
- Disabled room.
- Concurrent picking.
- Failed delivery.
- Inventory count variance.
- Cash variance.
- Wallet correction approval.
- Reconciliation with more than one history page.

Browser validation should continue across:

- 1440px.
- 1024px.
- 768px.
- 390px.

Also verify:

- Keyboard navigation.
- Focus behavior.
- Accessible names.
- Visible error states.
- No horizontal overflow.
- No unexpected console/browser errors.

## Acceptance

All required suites pass on the exact release candidate and again on the actual merged/release commit.

---

# Phase 13 — Performance and concurrency certification

Test above expected school peak with headroom.

Simulate overlapping:

- POS purchases.
- Student-store orders.
- Refunds.
- Wallet deposits.
- Enrollment.
- Inventory changes.
- Fulfillment updates.

Prove:

- No duplicate settlement.
- No duplicate wallet credit.
- No oversell.
- No lost wallet update.
- No lock-order deadlock.
- No cross-student access.
- No negative inventory.
- No impossible order state.
- No duplicate fulfillment.

Record observed latency and concurrency profile instead of inventing a reliability percentage.

---

# Phase 14 — Physical hardware and school-network acceptance

Software-only CI cannot close this phase.

## 14.1 RFID/card

Test:

- Real card.
- Actual reader.
- Leading zeros.
- Enter behavior.
- Repeated scan.
- Accidental double scan.
- Replacement card.
- Unreadable card.

## 14.2 E202 enrollment

Run the real journey:

**Student → correct roster identity → card → private PIN → login → purchase**

## 14.3 POS hardware

Test the actual production equipment:

- Mac/PC.
- Touchscreen/tablet if used.
- Card/RFID reader.
- Cash drawer if electronically connected.
- Receipt printer if used.

If no printer is used, document the digital-receipt process.

## 14.4 School network

Test on actual school Wi-Fi:

- POS.
- E202.
- Student mobile store.
- Network interruption.
- Reconnection.
- Lost-response recovery.

## Acceptance

Real school equipment and network pass the complete transaction/recovery journey.

---

# Phase 15 — Operator manuals and permanent procedures

Documentation is part of the product.

## Cashier

Document:

- Login.
- Open shift.
- Wallet sale.
- Cash sale.
- Split sale.
- Change.
- Receipt lookup.
- Refund request.
- Close shift.

## Enrollment

Document:

- Find roster student.
- Verify identity.
- Issue card.
- Set PIN privately.
- Replace card.
- Reset PIN.
- Revoke lost card.

## Inventory

Document:

- Create/edit product.
- Receive stock.
- Stocktake.
- Damage/write-off.
- Price change.
- Low-stock handling.

## Fulfillment

Document:

- Accept.
- Assign.
- Pick.
- Ready.
- Deliver.
- Fail delivery.
- Return.

## Accountant

Document:

- Shift review.
- Variance approval.
- Reconciliation.
- Reports.
- Export.
- Discrepancy escalation.

## Super Admin

Document:

- Staff.
- Terminals.
- Students.
- Security.
- Feature gates.
- Incident controls.

## Incident

Document:

- System unavailable.
- Database unavailable.
- Unknown payment result.
- Lost/stolen terminal.
- Compromised credential.
- Financial mismatch.
- Recovery/restore escalation.

## Academic year

Document:

- Graduate Y12.
- Promote years.
- Import incoming students.
- Handle exceptions.
- Verify balances/cards/history.

## Acceptance

A trained operator can execute routine work and first-line recovery without developer database access.

---

# Phase 16 — Production cutover

Final cutover sequence:

1. Freeze release candidate.
2. Run full exact-head CI.
3. Tag release candidate.
4. Preserve production backup/snapshot.
5. Confirm production data baseline.
6. Apply reviewed production migrations.
7. Verify schema/API/grants.
8. Provision real staff.
9. Register real terminals.
10. Configure real products.
11. Load/count opening inventory.
12. Verify every real wallet opening balance.
13. Confirm no demo login works.
14. Deploy staff production surface.
15. Deploy student-store production surface.
16. Run security/origin/session smoke tests.
17. Run one controlled E202 enrollment.
18. Run one controlled POS transaction.
19. Run one controlled online order.
20. Exercise an approved refund/return path.
21. Reconcile the controlled transactions.
22. Enable approved feature gates.
23. Open production access.

Do not bulk-issue the 135 student cards as part of migration/cutover.

---

# Phase 17 — Supervised production pilot

Before final certification, run a limited supervised live period.

Cover:

- Multiple staff.
- Actual student enrollment.
- Wallet transaction.
- Cash transaction.
- Split transaction.
- Online order.
- Picking/delivery.
- Refund/return.
- Cash close.
- Daily reconciliation.

For every operating day reconcile:

- Sales.
- Wallet liability.
- Cash.
- Refunds.
- Inventory.
- Online orders.
- Unresolved recovery requests.

Every discrepancy becomes a tracked blocker until explained.

---

# Phase 18 — Final production certification

CampusPay is production-finished only when all required phases are accepted.

## Final release record

Produce:

- v1.0.0 release tag.
- Exact Git commit SHA.
- Source tree hash.
- Production migration inventory.
- Production database/project reference.
- Deployment IDs.
- Staff origin.
- Student-store origin.
- Production configuration/feature-flag profile.
- Exact CI workflow/run IDs.
- Backup/restore evidence.
- Hardware/network acceptance evidence.
- Reconciliation evidence.
- Known limitations.
- Operator manuals.
- Incident runbook.
- Academic-year rollover runbook.
- Signed/dated production acceptance record.

Then:

- Close issue #4.
- Update README from “pilot” to production status.
- Keep documentation current as operating procedure, not as deferred V2 work.

---

# Permanent product scope because there is no V2

The following items are explicitly part of the final product and must not be deferred as “later-version” work:

- Partial refunds and returns.
- Cash-funded wallet deposits.
- Complete drawer cash movements.
- Complete paginated histories.
- Complete filtered/date-range exports.
- Daily reconciliation.
- Inventory stocktake and variance.
- Product lifecycle management.
- Store open/close/cutoff.
- Delivery-location administration.
- Persistent multi-user fulfillment assignment/picking.
- Student/card/PIN lifecycle.
- Student withdrawal/graduation/archive.
- Academic-year rollover.
- Staff/terminal lifecycle.
- Production monitoring.
- Alerting.
- Backup/restore drill.
- Incident runbook.
- Physical-device acceptance.
- School-network acceptance.
- Operator documentation.
- Final production release evidence.

# Explicit non-goals unless the owner later changes the product requirement

“No V2” does not mean building unrelated enterprise features.

The following remain out of scope unless there is a concrete school requirement:

- Native iOS/Android applications.
- Multi-school tenancy.
- Loyalty/gamification.
- Cryptocurrency.
- Predictive analytics.
- Complex external acquiring/card-processing gateway.
- Multi-wallet checkout.
- Fully offline financial settlement.
- Large logistics/warehouse platform.
- Cosmetic redesign for its own sake.

The goal is a complete school POS/wallet/store system, not an open-ended enterprise platform.

# Final definition of done

CampusPay is finished when the school can:

- Maintain the student roster.
- Enroll and replace cards safely.
- Manage staff and terminals.
- Fund and correct wallets with auditability.
- Sell through POS using wallet, cash and split tenders.
- Sell through the student online store.
- Manage products and inventory.
- Perform stocktakes.
- Fulfill and deliver orders.
- Handle failures, cancellations, partial/full refunds and returns.
- Track every physical cash movement.
- Reconcile every won.
- Export complete histories.
- Close each operating day.
- Detect and recover from unknown outcomes.
- Restore the service from backup.
- Operate through the school’s real devices/network.
- Roll students into the next academic year.
- Perform routine operation without developer database intervention.

When those conditions are met, the exact release is tagged, deployed, reconciled and accepted, CampusPay can be declared production complete.
