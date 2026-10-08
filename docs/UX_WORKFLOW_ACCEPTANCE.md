# Workflow clarity pass

Base: main `5830ccc` (schema history 40). Work is local, uses disposable synthetic fixtures, and does not enable any production feature. Existing photo-provider setup and forced-lock repair are separate work. PR41 is an older recoverable-hide/restore proposal, not permanent deletion; it is not incorporated here.

Acceptance for each page: one clear purpose, a permitted primary action or explicitly read-only purpose, reachable completion/receipt, useful empty/loading/error states, explicit cancel, no implicit replay after an unknown result, visible keyboard focus, and usable 390px/1440px layouts. No mutation is added merely to make a report look actionable. Server authorization remains authoritative.

| Page / entry | Relevant access and purpose | Primary action and completion | Cancel/error/recovery acceptance | Status |
| --- | --- | --- | --- | --- |
| `/`, `/register`, `/finance`, `/admin` | Assigned workspace capabilities | Redirect to first usable permitted task | No blank dashboard/duplicate tab; unavailable access has a sign-out path | Redirect/navigation smoke passed; no redirect changes |
| `/login`, `/access-unavailable` | Staff authentication | Sign in to authorized workspace / sign out | Generic errors, failed-sign-out notice; forced-lock concealment issue tracked separately | Navigation smoke passed; forced-lock limitation remains separately tracked |
| `/pos` | pos.read/checkout, coupon redemption separately | Build cart → reviewed payment → receipt → next sale | Cancel unpaid intent; preserve/recover unknown payment; duplicate clicks never duplicate a sale | Receipt handoff passed at both widths; 11 checkout/recovery groups passed |
| `/orders` | orders.read/fulfill | Select order → inspect delivery → explicit advance | Read-only roles cannot advance; refresh/race failure stays visible | Both-width selection/return, stale queue, failed refresh and one mocked status update followed by GET recovery passed; native fulfillment SQL unchanged |
| `/cash` | Drawer capabilities, custody enforced | Review count → open/close → recorded result | Original operator/terminal recovery; unsupported drawer operations not invented | First-column variance action, focus/cancel and loading/empty states updated; eight native custody/stale-read/original-recovery browser checks passed |
| `/cash/movements` | cash.movement.record plus installation gates | Existing supported prepare/verify/confirm workflow | Disabled installation must explain unavailability; retain recovery | Disabled-state route smoke covered; no backend expansion or posting retest |
| `/cash/history` | cash.history.all | Review closed-shift history | Dates/pagination/error retry; no rewrite of closed records | Both-width failed read/retry, first-column details dialog/return and invalid-date feedback passed; native history/export SQL unchanged |
| `/inventory` | Inventory read/manage/price/receive/adjust separately | Select one product → contextual action; return to filtered list | Focus moves to selected record; stock review shows quantity/lot/reason; cancel is initially focused; original request recovery preserved | Selected action now focuses its form; both-width selection, stock review/cancel, duplicate-click and original-response recovery passed |
| `/coupons` | coupons.read/manage separately | Directory first; deliberately open create; retain one-time code confirmation | Loading/retry; creation remains mounted when collapsed; deactivation is labelled honestly | Both-width directory failure/retry and creation draft preservation passed; performance report now distinguishes failed reads from zero activity |
| `/students` | students.read/enroll, wallet/credential/status capabilities separately | Search → guarded student dialog → account action | Preserve filters/focus; dirty cancel confirmation; unresolved operations block leaving | Seeded account/history/status return passed at both widths; 13 UI regression groups passed |
| `/students/[id]/complete` | students.enroll | Complete initial card/PIN issuance | No reset-PIN substitute for first issuance; original-key recovery | 11 isolated enrollment acceptance groups plus browser validation, layout and lost-response recovery passed |
| `/security` | Credential reset/replacement scopes | Selected student → verify current identity → one-use approval | PIN scrub/expiry; no unresolved replay | Five native/browser security-recovery groups passed; selection/return, PIN clearing and unsubmitted approval cancellation also passed at both widths |
| `/accounting` | wallet.read | Redirect to Students | Avoid duplicate wallet/sales tabs | Redirect retained; navigation suite passed |
| `/funding` | wallet.read/correct/reverse/approve separately | Review journal or initiate explicit approved correction | Installation/readiness blockers; original-key recovery; no invented cash-deposit support | Journal reads track the current filter and clear read errors separately; both-width receipt dialog/return and retry passed; eight native groups / 60 synthetic receipts passed |
| `/refunds` | refunds.read/issue/cash_payout separately | Receipt reference → full-sale review → immutable refund → eligible handover | Incoming receipt is prefilled, not submitted; preserve reference switching modes; readiness/custody enforced | Both-width receipt prefill and full/item handoff passed; no implicit refund submission |
| `/refunds/items` | Same capability separation | Receipt → remaining quantities → item refund → choose receipt | Full-sale cancellation distinction; no duplicate quantities/payout; opaque-key recovery | Both-width receipt prefill and full/item handoff passed; no implicit refund submission |
| `/reports` | Each report permission independently | Choose one report → filters/results; receipt links only with refunds.read | No simultaneous irrelevant tables; missing permissions cannot expose panels; useful empty/retry | Authorized one-panel selection passed; coupon/inventory/wallet failed-read → retry → empty states passed at both widths |
| `/reconciliation` | reconciliation.read | Choose day → investigate checks → export snapshot | Do not hide discrepancies or imply physical acceptance; links only to authorized destinations | Permission-gated links retained; both-width failed read/retry, no-activity and visible-discrepancy states passed with synthetic responses |
| `/administration` | staff/terminal management; exact access separate | Directory → one selected record → profile/status/session/access action | Directory hidden while editing; preserve immutable snapshot/recovery; cancel returns focus | Both-width focus/return passed; 10 controlled lock and four editor regression checks passed |
| `/settings/payments` | settings.payments.manage | Explicitly configure time-bounded cash policy | Review/current terminal scope/error; no implicit enablement | Explicit confirmed on/off feedback added; native receipt/policy suite (seven combined groups) and both-width mocked duplicate-submit/save feedback passed |
| `/store/login` | Customer credentials only | Sign in to known customer destination | Safe return URL; card/PIN error help | Synthetic customer login and isolated-navigation smoke passed |
| `/store` | Authenticated customer | Catalog → cart → delivery/review → confirmed order | Keep unknown-order recovery; no repeated wallet charge; empty/sold-out states | Both-width customer smoke and 11 checkout/recovery groups passed |
| `/store/orders` | Same customer ownership | Read delivery timeline/order/refund receipts | Useful no-orders link; no cross-customer details | Authenticated customer route/layout smoke passed; receipt data unchanged |
| `/store/account` | Same customer ownership | Read wallet and obtain E202 credential support | Do not invent unsupported self-service credential changes | Authenticated customer route/layout smoke passed; credential-help purpose retained |

Permanent deletion is not implemented by changing button labels. The exact proposed API/database boundary is in `PERMANENT_DELETION_PROPOSAL.md`; linked financial/audit records remain protected.

## Local evidence and limits

Branch: `feat/workflow-clarity-20261008`, based on `5830ccc28e83276f36ef16786a4deea35fa56155`. Remote main still matched that commit when checked on 2026-10-08. No production connection, migration, feature flag change, publication or deployment was performed in this pass.

- `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`: passed; 46 files / 503 unit tests. Lint retains one pre-existing unused `setRevision` warning in AccountingScreen.
- `.validation/workflow-states/results.json`: 20 groups / 18 screenshots at 390px and 1440px. Actual application, synthetic browser-intercepted API responses for orders, security selection/cancel, journal/receipt dialogs, variance review, settings, reports and reconciliation; these are UI-state checks, not native financial postings.
- `.validation/workflow-clarity/results.json`: 12 real-app groups, 390px and 1440px, 20 screenshots (rerun after the final focus refinement); local synthetic DB only.
- `.validation/navigation-ux/results.json`: five navigation groups / 23 routes, four roles, desktop/mobile, keyboard and overflow checks.
- `.validation/access-workspaces/results.json`: four groups / nine effective-access profiles; denied report query falls back to an authorized panel, with only assigned report choices.
- `.validation/ui-fixes/results.json`: 13 synthetic-browser groups for student focus, funding readiness/recovery and stale access display.
- `.validation/administration-hardening/results.json`: 10 controlled lock cases and four two-operator editor checks.
- `/tmp/campuspay-workflow-product-photo-navigation.log`: both-width photo draft navigation and staged-upload recovery passed unchanged.
- `.validation/completion/results.json`: 11 native acceptance groups plus real browser validation, responsive layout and lost-response/reload recovery.
- `.validation/security-recovery/results.json`: five native/browser groups, including committed reset with lost response and expired-session handling.
- `.validation/receipt-policy-recovery/results.json`: seven groups, including native payment-policy correction and original receipt recovery.
- `.validation/operations/eligibility.json`: eight native browser groups for owner/override, stale reads, paging races, denied submissions and one committed-lost close recovered under its original key. Isolated helper runner: `.validation/workflow-states/cash-eligibility-runner.mjs`.
- `.validation/funding/results.json`: eight groups / 60 API-recorded synthetic receipts, contextual reader/funding recovery and ledger invariants.
- `.validation/checkout-store/results.json`: 11 groups, including stalled/committed-lost requests, repeated recovery and concurrent placement with one charge.

Smoke coverage is not a complete mutation test of every route. The entire database suite was not rerun. Native credential/enrollment/funding/policy regressions listed above were rerun; native refund settlement, cash-history export and reconciliation totals were not newly requalified by the second pass. Browser coverage is Chromium at the two stated widths; physical devices, other engines, screen readers and live deployment are not qualified here. Permanent deletion remains the explicit separate linked backend proposal. Existing photo-provider setup and forced-lock runtime work remain separate.

## Remaining work and coverage boundaries

No additional confirmed independent UI defect remains from this finite checklist review. The following are explicit remaining scopes, not claims that all possible states have been proven:

- Permanent deletion: backend/API/SQL contract and retention/identifier decisions in the separate proposal; do not replace Archive/Deactivate labels to simulate completion.
- Forced-lock concealment: separately owned runtime repair; this branch does not change inactivity or session behavior.
- Product-photo provider activation and live storage checks: separately owned and require provider access/operational authorization; local photo draft/recovery regression passed.
- Live hardware (card reader/printer), physical phones/tablets, WebKit/Firefox and screen-reader testing were not performed. Chromium at 390px/1440px was exercised; enrollment/funding suites additionally cover their recorded viewport sets.
- Full native fulfillment transition concurrency, history/export edge cases above 50,000 rows, and reconciliation totals were not rerun in this second pass. The corresponding SQL/API implementations are unchanged. UI status/error/return behavior is covered with synthetic responses where stated.
- The original refund settlement and stock-recovery backend fixes remain existing release work; this pass rechecks affected handoffs/recovery, not the entire security audit.

The new UI-state test's early failures were fixture/assertion issues (route-announcer ambiguity, heartbeat interception and date-error ambiguity), corrected without weakening outcome checks. The isolated cash helper initially lacked its two fixture identities; rerunning with the original helper's required setup passed all eight checks. Earlier failure evidence is retained under `.validation/workflow-states/attempts/`; current results files are authoritative.

## Independent review and final acceptance

An independent reviewer inspected all production diff paths, tests, the deletion proposal and desktop/mobile screenshots. Two introduced low-severity issues were fixed: coupon deactivation confirmation previously disappeared during directory reload, and Security Back could lose focus when its original row was absent. Confirmation now survives delayed/failed reads with GET-only retry and stale-response protection; Back falls back to the search input. Added browser cases also verify that an in-flight order update cannot steal focus or permit a second update after returning to the queue. The reviewer rechecked the fixes and mobile confirmation screenshot and reported no remaining confirmed finding. Their review was static/source/screenshot review; the executing agent ran the tests.

| Disposition | Workflow scope | Evidence or remaining boundary |
| --- | --- | --- |
| Done with test | Inventory, POS/refund handoff, customer routes | 12 real-app groups; retained 11 checkout/recovery groups; no auto-submitted refund |
| Done with test | Orders, security selection, coupons, payment feedback | 20 UI-state groups, including held responses, duplicate submission and return focus; five native security groups and seven combined receipt/policy groups |
| Done with test | Students and credential completion | 13 UI regression groups; 11 native completion groups plus browser recovery |
| Done with test | Cash, funding, historical receipt dialogs | Eight native cash checks; eight funding groups / 60 synthetic receipts; dialog/retry UI coverage |
| Done with test | Reports and reconciliation display | Authorized panels and failed/empty/discrepancy states at both widths; calculation implementations unchanged |
| Done with test | Administration, access and routing | 10 lock cases + four editor checks; nine access profiles; 23-route navigation coverage retained |
| Blocked by decision/owner | Permanent deletion | Proposal only; retention, identifier reuse and setup-record handling decisions outstanding |
| Blocked by owner | Forced-lock concealment; live photo-provider activation | Separate work; no live activation or runtime fix in this branch |
| Not exercised | Native fulfillment concurrency, >50,000-row exports, reconciliation totals | SQL/API/calculations unchanged; no new native qualification claimed |
| Not exercised | Production, hardware, other browser engines, screen readers | Local synthetic Chromium coverage only |

Local tooling was Node 24.19.0, Next 16.3.8 and React 19.2.8 using the existing installed tree. No fresh npm ci or new-branch CI was run; CI uses Node 22. The checkpoint is local only: publication, PR creation, merge and deployment are not authorized for this broad pass. The external handoff records the exact checkpoint commit and patch hashes.
