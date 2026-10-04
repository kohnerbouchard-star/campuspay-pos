# CampusPay management, confirmation and role-journey audit

## Release status and evidence boundary

Baseline source: `d2a974b45c73d6b6e25bd35778864068cdf2c3c0`, tree `ca4d85dab1e58403b7fc361c9dd9e509138db654`. The actual-main validation archive (run `36982625558`, artifact `11216318786`) was downloaded and SHA256 verified: `26fe592d35814e449706321bba82f6155f87f0423fe08141a54abc8406bf9c7c`. Its archived source reproduces the baseline tree.

This is a code, role-contract and synthetic-browser audit, not a school-user study or certification that every production workflow is correct. The owner reports manually deploying the preceding patch. The connected Vercel project read still returned Project not found; independent production deployment/log verification was not available. Live Neon inspection was read-only and found administration, funding, cash-controls and refund activation off, plus existing inactive products and a student. No live account, product, wallet, flag or database schema was changed by this audit.

The changes below are a new migration-dependent release candidate. Exact CI evidence and release status must be recorded on its PR. This document alone is not evidence that the new code is tested, merged or deployed.

## Principal findings and implemented changes

1. **Record lifecycles were incomplete or hard to discover.** Product creation existed, but there was no usable catalog metadata editor or active/archived directory. Staff deactivation existed inside a generic form; student deactivation was not an application workflow. The new product manager adds edit/archive/restore with pagination and visible blockers. Staff lists gain direct deactivate/reactivate entry points. Student details gain a separate status workflow.
2. **Deletion must not mean erasing financial history.** Products are archived, staff and students deactivated; the same identity can be restored. SKU and employee/student IDs are not recycled. Stock removal is an audited physical adjustment, not product deletion. Sales, orders, wallets, card/PIN records and ledgers are not deleted. There is deliberately no generic DELETE endpoint or direct balance/quantity editor.
3. **Review and approval were inconsistent.** A reusable `ConfirmationDialog` now covers product creation/details/price/status, student status, and existing staff/register administration. It names the record, explains consequences, supports correction/cancel, focuses the least destructive action, contains keyboard focus and prevents duplicate confirmation while busy. Status and high-impact access changes require the displayed record code. PINs and raw card reads do not appear in summaries. The existing student enrollment workflow and its end-to-end tests remain unchanged; a further enrollment confirmation redesign is not part of this patch. Existing specialized payment, refund, stock-removal and coupon dialogs remain; a generic popup does not replace their domain-specific controls.
4. **A signed-in role is not blanket permission.** Both the page/action UI and API/database independently enforce authorization. Role descriptions now distinguish accountant refund viewing from Super Admin refund posting. Staff and student identity creation are explicitly separate. Self/last-admin, stale-version and open-cash-drawer safeguards remain enforced by the existing staff lifecycle.
5. **Inactive students need enforcement beyond their profile screen.** Existing customer authorization and POS/funding checks already examine active status, but legacy wallet confirmation relied on card-scan state. Its wrapper now checks active status under a lock before an unposted adjustment proceeds. A session-insert trigger also rejects a login that observed active status before deactivation but attempts to insert afterward. Posted historical receipt recovery is not converted into a new charge or denied by ordinary record-edit controls.
6. **Feature disabled was confused with feature missing.** Staff administration's directory can now load read-only while either activation gate is off; write controls remain disabled with an explanation. This audit does not enable administration or any financial gate.
7. **Losing a response cannot imply failure or permission to retry blindly.** New product/status operations use a durable operation journal, exact payload proof, original operator/register ownership, optimistic versions and an opaque browser recovery key. Recovery returns the authoritative result or permanently closes an unposted request under the same lock. No PIN, raw card number or editable form payload is persisted. A storage failure retains a safety block.

## Supported management actions and safeguards

| Entity | Actions | Required authority | Important conditions |
| --- | --- | --- | --- |
| Products | Create; edit name/category/reorder level; change price; archive; restore | Inventory Admin or Super Admin, with the corresponding existing product/price permissions | New product starts with zero stock. Archive requires zero remaining stock and no unfinished online order. Changes use a reviewed version; price changes retain price history. |
| Staff | Create; edit role/name; deactivate/reactivate; reset PIN; sign out sessions | Super Admin and existing application/database administration activation | Current administrator PIN, explicit review, existing optimistic checks; no self-lockout or loss of the last admin. Open drawer blocks relevant deactivation/role changes. |
| Students | Existing enrollment; existing roster completion; new deactivate/reactivate | Super Admin; existing issuance gate still applies to roster completion | Existing identity/card/PIN validation for enrollment remains unchanged. Status changes need current Super Admin PIN; deactivation requires zero wallet balance and no unfinished order. Sessions are revoked; identity and credentials retained. |
| Registers | Existing rename, deactivate/reactivate, session sign-out | Super Admin and administration activation | Current-register destructive controls disabled; use another register. Close open cash shift first. Registration is browser-token based, not physical-device identity. |
| Coupons | Existing create and deactivate | Inventory Admin or Super Admin | Existing review/reason dialog retains prior redemption history. Editing terms means replacement, not rewriting completed discounts. |
| Stock/financial journals | Existing receiving, removal, refunds and corrective entries | Existing operation-specific roles, approvals and activation | No hard deletion or journal rewrites. Keep operation-specific reviews and unknown-result recovery. |

Archive is not a substitute for accounting for remaining stock. Historical refunds may legitimately return units to an archived product, or money to an inactive student's wallet; the preserved records and history remain visible and can be restored/reactivated deliberately. Do not reject a valid historical correction merely to keep an archived record at zero.

## Role journeys

**Cashier:** Sign in directly to POS, take an authorized sale, handle permitted online-order fulfillment, and use the assigned drawer/permitted cash tasks only when activated. No catalog editing, user management, wallet corrections, or refund issuance. Maintain the original payment recovery reference after an uncertain result.

**Inventory Admin:** Sign in directly to Inventory. Add and review a product with zero stock, receive stock separately, inspect lots, review price changes, or record physical removal. Archive only once stock/open-order prerequisites are resolved. Find archived records and restore the same SKU. Can manage coupons and fulfill orders, and request student PIN/card assistance with Super Admin approval. Cannot adjust wallets or manage staff/student status.

**Accountant:** Sign in directly to Wallets & accounting. Find the existing wallet, use the authorized funding/correction path, and review journals, refunds, cash history and reconciliation. Refund issuance remains Super Admin-only. Product and user changes remain unavailable. Existing funding adoption gates decide which financial workflow is permitted.

**Super Admin:** Retains direct POS landing and the authorized navigation groups. Manage staff under Staff & registers, not Students. Select the existing student before changing status or credentials; a roster/card-only record is not an excuse to enroll a duplicate. Review the named target, supply fresh authorization, confirm the intended code, then inspect the receipt and refreshed status. Own account/current register and outstanding funds/stock/orders have explicit safeguards.

**Student/customer:** Use only the separate store login/catalog/orders/account surfaces. Staff management APIs reject customer cookies. A deactivated account cannot spend or acquire a new customer session; reactivation requires a fresh sign-in and does not issue missing credentials. Order and payment history are preserved.

## Route audit coverage and remaining issues

| Page/workspace | Result or remaining concern |
| --- | --- |
| `/` and `/login` | Preserve four role-specific landings and staff/student session separation. |
| `/pos` | Shared confirmations do not alter sale settlement. Unsaved cart persistence, mobile cart access and physical-reader acceptance still need separate work. |
| `/orders` | Preserve fulfillment authority and unfinished-order guards. Shared server-backed picking and complete history pagination remain outstanding. |
| `/inventory` | New lifecycle manager, explicit permissions, reviews, versioned price edits and same-key recovery. Existing stock-removal recovery repairs in separate PRs remain unresolved. |
| `/coupons` | Existing deactivate dialog preserves discounts. Optional-field simplification and draft handling remain future work. |
| `/students` | Clear staff/student distinction, existing enrollment workflow preserved, selected-account status management, receipt retained while the selected account refreshes. |
| `/students/[studentId]/complete` | Existing identity/issuance gates preserved. Parent navigation retained; do not use PIN reset as first issuance. |
| `/accounting` | Inactive-student check added to the legacy confirm path. Consolidation with funding and scoped draft persistence remain future work. |
| `/funding` | Existing independent approvals and feature gates preserved; accountant/cashier distinctions remain intact. |
| `/cash` and `/cash/history` | Existing drawer controls and original role restrictions preserved; navigation is unchanged. Guided closing remains outstanding. |
| `/refunds` and `/refunds/items` | Viewing is not issuing. Existing Super Admin-only posting and feature gates preserved; no deletion of originals. |
| `/reconciliation` | Do not silently adjust discrepancies. Exception-led summaries and guided next steps remain outstanding. |
| `/reports` | Existing role-filtered report anchors remain; no newly exposed report permissions. |
| `/security` | Existing fresh step-up and uncertainty handling preserved. Card-only missing-PIN repair remains the separate credential-lifecycle work, not a new reset shortcut. |
| `/administration` | Read-only visibility when disabled; explicit staff status entry points, role descriptions and target-aware review. Existing backend lifecycle and lockout protections retained. |
| `/settings/payments` | Prior receipt/policy validation fix retained; this remains a register-specific switch, not school-wide activation. |
| `/store/login` | Inactive-session insertion fence supports deactivation. Staff login remains separate. |
| `/store`, `/store/orders`, `/store/account` | Existing short aliases and navigation retained; drafts, history pagination, and real student usability checks remain outstanding. |

These entries account for the same 23 page-route files as the prior navigation audit. Two new API endpoints support the new management operations; they are not new student-facing pages.

## Technical release and safety requirements

Apply paired migration `20261004090000_record_management.sql` / canonical module `043_record_management.sql` **before** the corresponding application release. This is additive but includes a narrowly wrapped legacy wallet-confirmation function and a customer-session trigger. Rehearse the exact migration on an isolated branch/database, inspect the installed old function signature and drift, and retain the approved production backup/recovery plan. Do not rewrite historical migrations or substitute unrelated PR #33/#34 migrations. Modules 040–042 are intentionally not claimed installed.

Student status changes use a per-student advisory lifecycle lock with a five-second lock timeout. Login, enrollment and active-student financial writers acquire the same lock before their student/wallet/session mutations. Payment and funding confirmation first authenticate and lock the authoritative intent, then resolve its assigned student. Receiving holds sorted product row locks through active validation and lot insertion so it cannot introduce stock after an archive. Production load/latency and real-device testing are not certified by the synthetic suite.

Student status approval asks for the current Super Admin PIN inside the final confirmation, clears it on cancellation/submission/expiry, and expires after one minute or leaving the tab. Confirmation also checks the deadline synchronously in case browser timers are delayed. A committed status change retains its success and audit reference when roster refresh fails, with a separate refresh warning and retry action.

No staff or financial feature flag is automatically enabled. Staff management will remain read-only until the owner separately approves the existing application and database administration activation. No role permissions are broadened. An application rollback does not require deleting the additive journal; do not remove histories or disable session/active-account safety fences to roll back presentation changes.

## Verification plan

The new unit suite validates strict action kinds, legal field bounds, version fidelity, safe error messages, opaque-only recovery and role-review wording. The new disposable PostgreSQL/HTTP/browser suite checks permission denial, new product/exact replay/closure, CAS conflicts, stock/balance/open-order guards, inactive customer and pending wallet boundaries, audit/journal preservation, dialog focus/cancel/busy behavior, lost-response/reload recovery, responsive layouts and disabled administration visibility. Existing security, financial, navigation, enrollment, administration, refund, reconciliation and encrypted-restore tests remain enabled. Record the exact result, not only the existence of these tests, on the PR.

Accessibility design basis: W3C APG Modal Dialog and Alert Dialog patterns; WCAG 2.2 Understanding 3.3.4 Error Prevention (Legal, Financial, Data). These support deliberate review/correction and safe focus behavior, not indiscriminate confirmation for every navigation click. This is not whole-app WCAG certification.
