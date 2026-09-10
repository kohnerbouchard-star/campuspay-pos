# CampusPay / MICA Money modernization delivery

This branch makes MICA Money the authenticated student storefront and gives staff a consistent operations workspace for checkout, fulfillment, enrollment, inventory, accounting, promotions, and credential security. Cash and split payments use the existing financial engine, inventory lots, coupon rules, and audit history. A completed sale reconciles to its tender journal; an incomplete payment posts no partial settlement.

**September 8 remediation:** See [the focused remediation report](UI_UX_REMEDIATION.md) for five-minute inactivity, card-first split preparation, cash auto-expiry, compatibility UX, current checks, and PR handoff.

**Final verification status:** unit, lint, TypeScript, production-build, static, isolated local HTTP integration, and real-browser checks all passed. All six isolated Neon checks passed with synthetic records rolled back. Screenshot review covered every major workspace and the four requested widths; evidence is linked below.

## Branch and revision provenance

| Requested delivery field | Value |
| --- | --- |
| 1. Branch | `feat/campuspay-ui-ux-refresh` |
| 2. Starting `main` SHA | `18aace8950820163974e6b1199db45bb16ae40ad`, from fetched `origin/main` |
| 3. Ending branch SHA | The final commit SHA is reported in the delivery message. It is intentionally not embedded in its own commit. |
| Repository | `kohnerbouchard-star/campuspay-pos` |
| Production boundary | No merge, deployment, or production Neon database modification. |
| Database verification environment | Isolated localhost PostgreSQL 17 and Neon branch `dev-ui-ux-refresh-20260907` (`br-late-bread-azrpu2xh`). |

The [pre-implementation audit](UI_UX_AUDIT.md) records the route, component, authentication, authorization, schema, inventory, wallet, coupon, and accounting findings. Before implementation, the complete existing validation, static checks, production build, and HTTP integration suite passed. The baseline unit suite contained 22 tests in six files.

## 4. Complete affected route inventory

“Changed” includes routes whose page file delegates to a refactored screen or an updated server operation. Shared navigation, tokens, error handling, origin validation, and session boundaries also apply across these surfaces.

### Application pages

| Route | Change and resulting behavior |
| --- | --- |
| `/` | Authentication-first staff entry. Redirects authenticated staff to their permitted operational workspace and unauthenticated staff to sign-in. |
| `/login` | New dedicated staff sign-in page with intentional loading, validation, failure, expiry, and safe return navigation. |
| `/pos` | Product search/categories, compact sale cart, wallet/cash/split tender selection, event-policy visibility, protected confirmation, persistent receipt, and interrupted-payment recovery. |
| `/orders` | Searchable staff fulfillment queue with status filters, recipient/room/item/amount/time visibility, picking checklist, actual status timeline, and only the next valid transition. |
| `/students` | New Super Admin student directory, enrollment workflow, account detail, and links to protected credential actions. |
| `/inventory` | Product register, stock/reorder indicators, inventory lots, costed receipts, product creation, price changes, and reviewed stock removal. Form success survives background refresh. |
| `/accounting` | Student funds workflow, wallet search and history, clear adjustment confirmation/recovery, and sales/payment reporting. |
| `/coupons` | Human-readable terms, controlled deactivation dialog, duplicate-submit protection, and a full-code issuance confirmation that remains until acknowledged. |
| `/reports` | New reporting workspace with sale revenue, channel and tender breakdowns, COGS, gross profit, transaction register, and coupon reporting. |
| `/security` | Dedicated permission-appropriate student lookup, explicit student/action context, Super Admin step-up, PIN reset, and card replacement confirmation. |
| `/settings/payments` | New Super Admin payment-policy workspace for the current register. |
| `/store` | Customer-authenticated storefront, wallet context, product search/categories, cart, controlled delivery selection, quote/review, wallet-only ordering, and recoverable request IDs. |
| `/store/login` | New MICA Money card/PIN sign-in with generic credential/lock feedback, safe return paths, and informational E202 enrollment instructions. |
| `/store/orders` | Customer-authenticated history with item quantities/prices, subtotal, discount, final charge, recipient/location/notes, status, and actual event timestamps. |
| `/store/account` | New customer-authenticated wallet/account support page with balance, debt, and E202 card/PIN/funding guidance. |

Root and store error boundaries provide actionable retry states. The store has a dedicated loading boundary. The global document metadata and both navigation surfaces use MICA Money branding.

On a configured dedicated store host, `/`, `/orders`, and `/account` resolve to the corresponding customer pages. Staff workspaces and APIs are blocked on that host. A configured dedicated staff host blocks the customer surface. Local development can expose both applications through one origin.

### New HTTP API paths

| Method and path | Authorization and purpose |
| --- | --- |
| `GET /api/students` | `students.manage` plus explicit Super Admin checks; safe student directory search. |
| `POST /api/students` | Same authorization; validated, rate-limited, atomic and idempotent enrollment. |
| `GET /api/security/students` | `security.credentials.request`; safe credential-management lookup without wallet disclosure. |
| `GET /api/pos/payment-policy` | `pos.read`; current terminal policy and whether the actor may change it. |
| `POST /api/pos/payment-policy` | `security.staff.manage` plus Super Admin role; audited terminal cash/event policy change. |
| `POST /api/pos/intents/:intentId/cancel` | `pos.checkout`; cancels an uncommitted proposal, with origin/body and UUID validation. |
| `POST /api/pos/intents/:intentId/recover` | `pos.checkout`; authorized staff on the original register may resolve an interrupted payment, with origin/body and UUID validation. |
| `POST /api/store/quote` | Customer session; authoritative cart/coupon/wallet review without financial settlement. |
| `GET /api/accounting/students/:studentId/transactions` | `wallet.read`; immutable wallet history for an authorized staff user. |
| `POST /api/accounting/intents/:intentId/recover` | `wallet.adjust`; authorized staff on the original register may recover an interrupted wallet adjustment. |
| `POST /api/inventory/receipts/recover` | `inventory.receive`; same-actor/register lookup of an existing stock receipt by idempotency key. |

The `GET` and `POST` methods above share nine new path patterns.

### Existing API paths whose behavior or connected workflow changed

| Method and path | Change |
| --- | --- |
| `POST /api/auth/login`, `GET /api/auth/session` | Role-aware workspace navigation and strict separation from customer authorization remain authoritative. New workspaces follow server permissions. |
| `GET /api/inventory/products` | Product-register response includes reorder threshold and low-stock status. Existing product creation remains the controlled creation path. |
| `POST /api/inventory/receipts` | Client now preserves the same request ID and frozen proposal while an outcome is uncertain, including across same-user reauthentication; confirmed success clears the form. |
| `POST /api/inventory/products/:productId/price` | Updated staff form with pending/success feedback and a required reason. |
| `POST /api/inventory/adjustments` | Exposed through the reviewed removal workflow; existing authorized stock/costing operation remains authoritative. |
| `POST /api/pos/intents` | Accepts the proposed wallet/cash/split mode; split contribution is finalized after card binding; cart and coupon pricing remain on the server. |
| `POST /api/pos/intents/:intentId/card` | Wallet/split card binding is integrated with the tender plan; cash-only checkout bypasses student authentication. |
| `POST /api/pos/intents/:intentId/confirm` | Performs one atomic settlement and returns the complete tender/received/change breakdown. |
| `GET /api/reports/sales` | Returns separate channel and tender information, including split totals and nullable cash-customer identity, without duplicating revenue. |
| `GET /api/orders` | Includes actual immutable fulfillment-event timestamps. |
| `POST /api/orders/:orderId/status` | Used by the new picking/fulfillment workflow; the database continues to reject invalid transitions. |
| `POST /api/security/students/:studentId/pin-reset` | Additional route validation and contextual reset UX preserve the existing one-use elevated authorization. |
| `POST /api/security/students/:studentId/card-reset` | Additional route validation and explicit replacement confirmation preserve the existing protected action. |
| `GET /api/store/catalog` | Requires a customer session at both HTTP and database boundaries. The old no-argument database function is removed. |
| `GET /api/store/locations` | Requires a customer session at both boundaries; controlled directory contents remain authoritative. |
| `POST /api/store/login` | MICA Money presentation, safe credential normalization/validation, and generic credential/temporary-lock feedback. |
| `GET /api/store/session` | Used only within the authenticated customer surface for wallet/profile refresh and recovery binding. |
| `GET /api/store/orders` | Includes the requesting student's own item detail and actual timeline. |
| `POST /api/store/orders` | Accepts optional `expectedTotalWon`; the new storefront always sends its reviewed amount. A changed amount is rejected before financial writes. Product price snapshots are locked consistently. |
| `POST /api/store/logout` | The customer shell signs out only the customer session and returns to protected access. |
| `POST /api/coupons`, `POST /api/coupons/:couponId/deactivate` | Updated issuance and confirmation UX, preserved request IDs, and human-readable success/failure handling. |
| `POST /api/accounting/intents`, `POST /api/accounting/intents/:intentId/card`, `POST /api/accounting/intents/:intentId/confirm` | Updated card/PIN adjustment workflow, pending-operation controls, and interrupted-result recovery. |

Shared JSON mutation handling validates the request against its configured staff or customer origin. Other existing report, inventory-lot, authentication/activity, and coupon-quote endpoint contracts remain available under their existing permissions.

## 5–6. Components and design system

### Major components created

| Area | Components |
| --- | --- |
| Shared UI | `Dialog`, `EmptyState`, `LoadingState`, `ErrorState`, `Money` |
| Student administration | `StudentsScreen`, `StudentDirectory`, `StudentDetail`, `EnrollmentForm`, `EnrollmentSuccess` |
| Customer commerce | `StoreShell`, `StoreBrand`, `CustomerLoginScreen`, `StoreCart`, `DeliverySelector`, `CustomerOrderCard`, `OrderTimeline` |
| Staff fulfillment | `FulfillmentOrderDetail` |
| Register payments | `PaymentPolicyPanel`, `PaymentSettings`, `ReceiptDialog` |
| Inventory | `StockAdjustmentForm` |
| Accounting/reporting | `WalletHistory`, `SalesReport` |
| Credential security | `SecurityStudentSearch` |

Supporting modules separate customer/staff return-path validation, order status presentation, tender validation, financial aggregation, and browser recovery markers from rendering.

### Major components refactored

- `WorkspaceFrame` and staff `LoginForm`: persistent permission-aware navigation, compact shell, role/terminal context, logout, and authentication-first entry.
- `POSScreen`, `ProductGrid`, `CartPanel`, and `PaymentDialog`: faster product discovery, clear sale totals, tender-specific collection, processing controls, recovery, and receipts.
- `StorefrontScreen`, `CustomerOrdersScreen`, and `OrderFulfillmentScreen`: separate consumer and operations experiences built around authenticated data, delivery, and order progress.
- `InventoryScreen`, `ProductForm`, `PriceChangeForm`, `ReceiptForm`, and `LotTable`: a searchable register and deliberate tasks with useful financial/stock presentation.
- `AccountingScreen`, `AdjustmentPanel`, and `WalletSearch`: explicit fund adjustments, readable balances, history, retries, and pending-result recovery.
- `CouponManagementScreen`, `CouponForm`, and `CouponTable`: clearer terms, controlled actions, and a usable coupon issuance confirmation.
- `SecurityScreen`: guarded student selection, action-specific authorization, reset expiry, and explicit replacement review.

The design system uses shared color, spacing, radius, surface, status, focus, form, button, table, and financial-number tokens in `globals.css`. Customer and POS styles are scoped where their layout differs. Monetary values use consistent KRW formatting and tabular figures. Native dialogs plus explicit Tab boundary handling provide focus containment and restoration. No heavyweight UI or animation framework was introduced.

## 7 and 15. Authentication, permissions, and security

Staff operational pages require a staff session. A cashier lands in POS, an inventory administrator in Inventory, an accountant in Accounting, and a Super Admin in POS. Navigation reflects permissions, while page handlers, APIs, feature services, and database functions enforce the actual authorization.

Customer pages require a separate customer session. Anonymous requests cannot retrieve product names/prices/stock or delivery locations. Login preserves only an allowlisted customer destination; external URLs, staff destinations, path traversal, and malformed return paths are discarded. A streamed Next.js login redirect is verified by its actual destination, not merely its HTTP status.

Staff and customer sessions retain separate host-only, HTTP-only cookies and distinct token fingerprint scopes. A staff cookie does not authenticate the customer store; a customer cookie does not authorize staff APIs. Existing idle/maximum session limits, credential locks, and rate limits remain in place. The customer sign-in screen intentionally gives the same credential-or-temporary-lock explanation for an unknown card, incorrect PIN, or locked credentials.

| Role / action | Result |
| --- | --- |
| Cashier | POS checkout and online fulfillment; cannot enroll students or change cash policy. |
| Inventory Admin | Inventory, coupons, permitted reports/credential requests, and fulfillment; no enrollment or organization-wide payment control. |
| Accountant | Wallet operations, permitted reports, and credential requests; no enrollment or event-policy control. |
| Super Admin | Student enrollment/management and terminal event-payment control, in addition to existing operational permissions. |
| Customer | Own wallet/profile/orders and authenticated catalog/directory/checkout only. |

A separate “Fulfillment Staff” database role was not invented: fulfillment continues to use the existing `orders.fulfill` permission assigned to the established roles. Credential operators can search safe student status without receiving wallet data they are not permitted to view.

The pre-existing user change to `next-env.d.ts` is preserved outside the implementation commit.

The runtime role still cannot directly read or mutate private tables. New operations use explicit entries in the fixed RPC registry and narrow `SECURITY DEFINER` functions with a pinned search path. New tender and enrollment records have explicit constraints, indexes, permissions, and immutable/audited behavior. Raw PINs, raw card reads, credential proofs, hashes, and authentication tokens are not returned in enrollment receipts or stored in browser recovery records.

## 8–10. Student enrollment, management, and physical credentials

The E202 workflow follows the authoritative student model: student ID, display name, active state, wallet, card, and credential. It introduces no grade/year, email, or online enrollment fields.

`/students` exposes enrollment only to a Super Admin. `students.manage`, an explicit Super Admin check in the service, and database authorization protect the operation. The form requires student ID/name, a captured physical card, a 4–12 digit PIN, and matching PIN confirmation. The existing reader capture mechanism is armed intentionally; the display reports that a card was detected without exposing its fingerprint. PIN fields are masked and cleared after success.

`api.enroll_student` commits the student, wallet, slow-hashed credential, card assignment, enrollment receipt, and audit event together. Any late failure rolls back every account record. Case/space-aware student-ID duplicate protection, card-history conflicts, request-bound idempotency, and an actor-wide enrollment throttle reject invalid attempts safely. The throttle allows 30 attempts per minute across terminals; duplicate attempts count, while exact successful retries do not.

Every new wallet starts at **₩0**. A non-zero opening balance is deliberately unsupported and rejected by the strict input schema. The enrollment audit records the zero opening balance. Later funding uses the existing Accounting card/PIN workflow and its ledger, rather than silently setting a balance. No zero-value financial entry is manufactured where the ledger prohibits one.

The success view reports the student's identity, active card, zero wallet, and readiness to sign in. The directory/detail view shows account, card, wallet, temporary credential-lock status, enrollment time, and safe audit reference. Existing users reach PIN reset and card replacement through the Security workspace. Existing 60-second, student/purpose/session-bound, single-use Super Admin authorization remains required. Switching the student or action clears authorization and sensitive inputs. Card/PIN changes revoke existing customer sessions.

Students cannot register online. `/store/login` directs students without a card to **E202**; its “How to get a MICA Money Card” action is informational only. See [STUDENT_ENROLLMENT.md](STUDENT_ENROLLMENT.md).

## 11–13. Cash, split settlement, and accounting data model

### Terminal-scoped event cash

Cash is disabled by default. A Super Admin must name the event and enable acceptance for the current register, identified by the existing terminal cookie. This setting applies to that browser/register, survives staff logout, and ends automatically at its configured future timestamp (at most 24 hours). A separate browser/profile has its own default-off policy. The setting is visible at POS and in Payment settings, and every change records the actor, terminal, timestamp, old/new state, event label, and end timestamp.

Cash-only checkout asks for cash received and shows change without requiring a student card, PIN, or wallet. It does not create a synthetic student, wallet debit, or wallet journal. It still prices the same products, validates applicable coupons, consumes the same inventory, allocates FIFO/LIFO cost, records COGS, and posts a normal POS sale.

### One wallet plus one cash tender

Split checkout scans the student card before showing server wallet capacity and choosing one MICA Money contribution; the remainder is assigned to cash. The cashier authenticates that wallet with card and PIN, enters cash received, reviews both settled amounts and change, and confirms once. The wallet contribution must be eligible under the shared −₩15,000 floor. Coupon discounts apply to the complete sale before either tender is allocated. Coupons requiring a per-student limit cannot be used anonymously in cash-only checkout.

The browser builds a proposal. One authoritative database confirmation rechecks session, policy, cart/pricing, coupon, card/PIN, wallet eligibility, tender equality, cash sufficiency, and inventory. Sale/header/items, immutable tenders, the wallet portion, inventory movements, lot cost allocations, COGS, coupon redemption, receipt, and audit commit together. A failing condition rolls the operation back. No permanent wallet charge occurs while cash is still being collected.

### Normalized tender journal and reconciliation

`private.sale_tenders` records one `WALLET` row, one `CASH` row, or both for a sale. It stores settled amount separately from cash received and change, with student identity on a wallet leg and terminal/event metadata on cash. A unique `(sale_id, tender_type)` constraint limits the implementation to one leg of each type. Existing wallet sales are backfilled with corresponding wallet tender rows.

Deferred constraints require every completed sale's tender sum to equal its final total. A wallet tender must also agree with the student's balance movement and linked wallet journal; a cash-only sale has no wallet identity or journal. Online sales are constrained to a wallet tender. Zero-value wallet settlement after a full coupon discount does not create a prohibited zero-value wallet journal.

`sales.channel` remains `POS` or `ONLINE_STORE`. `CASH` and `SPLIT` are payment concepts, not new sales channels. Reports aggregate each sale once, then independently show POS/online revenue, MICA Money/cash tender, split count, cash received/change, COGS, and gross profit. Cash received above the amount due is never counted as revenue.

### Exact acceptance example and verified rollback

The isolated Neon check executed this exact transaction and validated the committed records before rolling the synthetic fixture back:

| Field | Expected and verified |
| --- | --- |
| Sale / channel | One ₩12,000 sale, `POS` |
| Wallet tender and debit | ₩7,000 tender; wallet journal debits only ₩7,000 |
| Cash applied to sale | ₩5,000 |
| Cash physically received | ₩10,000 |
| Change returned | ₩5,000 |
| Revenue | ₩12,000, counted once |
| Inventory / cost | One item allocation and one cost allocation; fixture stock decreases by one and fixture COGS is ₩1,000 |
| Repeated confirmation | Returns the original sale; no second settlement |
| Tender reconciliation | Two tender rows total exactly ₩12,000 |

The corresponding attempt with only **₩4,000 cash** was rejected: wallet, completed sale, tenders, inventory, and COGS remained unchanged. The local integration helper additionally exercises coupon effects, concurrent inventory loss, invalid PIN, wallet-floor rejection, disabled event policy, duplicate confirmation, deferred constraints, and late injected failure. The final combined local execution result is recorded in the verification section below.

### Interrupted results

POS saves only the pending intent ID before confirmation. Recovery by authorized staff on the original register waits for in-flight settlement and returns its completed receipt or cancels an uncommitted proposal. Wallet adjustments use equivalent recovery. This deliberately allows an appropriately authorized colleague to resolve an interrupted operation on the same register; stock-receipt lookup additionally requires the original actor. Neither operation starts another charge to determine the result.

The store saves the reviewed proposal and request UUID, bound to the student, before placement. It restores the pending order in the same tab after reload/sign-in and replays that UUID. A later authentication error never proves an earlier unknown result failed. Stock receipts similarly preserve the request and use an authorized recovery lookup; an absent result can be retried with the exact saved payload and UUID. The unique receipt key is inserted before inventory changes, preventing concurrent duplicates. Unresolved operations remain frozen until their authoritative outcome is known. See [PAYMENTS.md](PAYMENTS.md) and [ONLINE_STORE.md](ONLINE_STORE.md).

## 14. Tracked database migrations

| Schema module | Versioned migration | Purpose |
| --- | --- | --- |
| `013_pos_tenders.sql` | `20260907090000_pos_tenders.sql` | Terminal cash policy, normalized immutable tender journal/backfill, deferred sale/wallet reconciliation, atomic POS cash/split, reports, and POS recovery. |
| `014_student_enrollment.sql` | `20260907120000_student_enrollment.sql` | Super Admin enrollment, managed student directory, safe security lookup, duplicate/idempotency/throttle controls, enrollment audit/receipt. |
| `015_store_experience.sql` | `20260907130000_store_experience.sql` | Customer-authenticated catalog/directory RPCs, quote, actual order timelines, reviewed-total validation, stable product pricing during online settlement. |
| `016_wallet_history.sql` | `20260907140000_wallet_history.sql` | Permission-checked wallet transaction history and an inventory product register with reorder status. |
| `017_adjustment_recovery.sql` | `20260907150000_adjustment_recovery.sql` | Same-register recovery by staff with wallet-adjustment permission. |
| `018_stock_receipt_recovery.sql` | `20260907200000_stock_receipt_recovery.sql` | Safe same-actor/register receipt lookup; corrects the ambiguous column in the existing receipt replay query. |
| `019_register_remediation.sql` | `20260908090000_register_remediation.sql` | Timestamp-enforced cash expiry, card-first split preparation, and versioned policy capability. |

Schema sources live in `database/schema`; deployable versions live in `database/migrations`. All seven new source/migration pairs were checked byte-for-byte. `database/bootstrap.sql` is a generated review artifact, not an additional production migration. Existing versioned migrations were retained. The new migrations were applied only in the isolated verification environments. Production rollout is a separate authorized activity and was not performed.

## 16. Visual QA and accessibility evidence

The visual harness targets **1440, 1024, 768, and 390 CSS pixels**. It captures real authenticated pages and workflows against the isolated local database, including staff/student login, E202 instructions, login failure, enrollment/reader/PIN confirmation/success, credential actions, store loading/error/retry/cart/review/receipt/history/account, fulfillment, inventory tasks, accounting/reports, coupons, event settings, cash, split, and payment receipts.

Automated browser assertions check nonblank pages, accidental document overflow, visible field labels, accessible button names, JavaScript/console errors, and native-dialog keyboard focus. Screenshots support human review of hierarchy, spacing, type, monetary values, status, and mobile behavior; an automated screenshot capture alone is not a visual sign-off.

| Token pairing | Verified contrast ratio |
| --- | --- |
| Primary action | 7.17:1 |
| Main body text | 15.80:1 |
| Muted text | 5.92:1 |
| Error text | 6.32:1 |
| Success text | 6.53:1 |
| Navigation text | 11.29:1 |

These token checks exceed AA normal-text contrast requirements for the measured pairings. They do not constitute a full WCAG conformance audit of every rendered state. Controls use clear labels, visible focus, status/error announcements, human-readable status text, and generally 44px or larger action targets. Critical currency amounts are kept intact; wide operational tables use labelled, keyboard-focusable scroll regions.

**Completed visual review:** 212 real Chromium captures cover 56 interface states at 1440/1024/768/390px plus a focused phone-view transaction-register check. Final results: zero document-overflow findings, missing visible field labels, unnamed buttons, unexpected console errors, or page errors. Both Tab and Shift+Tab remained inside dialogs. The deliberate login 401 and catalog 503 were handled and retry restored the store. Review included all major workspaces, enrollment/credentials, checkout/receipts, picking/delivery, wallet history, and inventory tasks. [29 retained screenshots and review notes](visual-qa/README.md) and the [complete capture manifest](visual-qa/browser-results.json) provide the evidence. Fixes from review include mobile table containment, legible report totals, date-filter wrapping, compact navigation, student-ID separation, coupon controls, enrollment validation, and dialog focus. The mobile transaction register was also verified in its visible viewport to exclude a full-page screenshot painting artifact.

## 17–19. Automated and integration verification

### Latest recorded automated checks

| Command / check | Result recorded while preparing this report |
| --- | --- |
| `npm run typecheck` | Passed. |
| `npm run test` | Passed: **114 tests in 16 files**. |
| `npm run lint` | Passed. |
| `npm run build` | Passed. |
| `npm run validate:static` | Passed: transpile/import boundaries, coupon policy, SQL structure, and security audit. |
| Complete original HTTP suite before edits | Passed on a fresh isolated localhost PostgreSQL 17 database. This is baseline evidence, not a substitute for final verification. |
| Isolated Neon migration execution | Passed for migrations 013–019 on the designated development branch. |
| `scripts/neon-branch-check.mjs` | Passed all six recorded checks; transaction fixtures were rolled back and verified absent. |
| Final isolated HTTP integration | Passed as part of `CI_BROWSER=1 node scripts/test-isolated.mjs`, exit 0. |
| Final `npm run test:visual` / combined browser run | Passed: real Chromium workflows at all four widths, no unexpected errors or layout/control findings. |

The unit suite covers permission mappings, safe return paths, same-surface origins, customer/API/host separation, enrollment validation, tender arithmetic, sales aggregation, recovery-record binding, coupon policy, wallet floor, costing, SQL parameterization, and architectural boundaries. New store tests verify that catalog/directory services are never called before authorization and that browser recovery keeps the same order UUID without persisting credentials.

### Local real-transaction coverage

`scripts/test-isolated.mjs` creates an isolated local database and runs the production build through `scripts/integration-test.mjs`. The specialized helpers extend the existing test suite:

- `enrollment-integration.mjs`: ordinary-role denial; required fields/PIN confirmation; duplicate student/card; exact student/wallet/credential/card/audit counts; zero opening balance; concurrent idempotency; injected late-failure rollback; new-student authentication/purchase; protected replacement/session revocation; throttle.
- `store-integration.mjs`: protected pages/catalog/directory/quote; staff/customer API isolation; safe actual redirect destination including streamed redirects; removed anonymous database RPCs; quote without financial writes; changed-total rollback; coupon rejection; exact order-event sequence; expired-session same-UUID recovery.
- `tender-integration-checks.mjs`: terminal-scoped policy; unauthorized changes; exact split and insufficient cash; no wallet impact from cash; change/revenue correctness; inventory and cost allocated once; failed coupon/PIN/wallet/inventory/policy/database paths; concurrent duplicate handling; journal immutability and reconciliation; reporting; recovery across reauthentication and terminal/actor boundaries; stock receipt concurrency/recovery.
- `visual-qa.mjs`: actual browser enrollment, credential reset, student login/order/history, cash/split payment, responsive screenshots, and keyboard/accessibility checks.

### Passed Neon checks

The recorded output in `.validation/neon-branch-results.json` reports:

1. Runtime API grants and private-table isolation.
2. Atomic zero-balance enrollment, exact retry, duplicate student/card rejection, and customer authentication.
3. Stock receipt replay/recovery returns the original receipt with unchanged stock and journal counts.
4. ₩4,000 cash underpayment leaves wallet, sale, tenders, inventory, and COGS unchanged.
5. Exact ₩12,000 / ₩7,000 wallet / ₩5,000 cash / ₩10,000 received / ₩5,000 change settlement, inventory/cost/replay correctness, and deferred constraints.
6. Verified rollback: no synthetic staff, student, product, or sale remains.

The migration DDL remains on the isolated development branch; the transaction fixture rollback does not mean production was changed and reverted. Production was not modified.

**Final result:** `npm run validate`, `npm run validate:static`, `npm run build`, and `CI_BROWSER=1 node scripts/test-isolated.mjs` passed. The final browser/local transaction run exited 0 after the last application change; unit result remained 114/114. The pinned Neon rollback run passed 6/6. Tracked evidence: [local integration](visual-qa/integration-results.json), [browser matrix](visual-qa/browser-results.json), and [Neon](visual-qa/neon-results.json). The implementation commit is the ending SHA supplied with the handoff; subsequent edits before that commit were documentation/evidence and restoration of the pre-existing generated type-reference change.

### Reproducing the isolated local run

The QA container is named `campuspay-refresh-test`, uses PostgreSQL 17, and binds only `127.0.0.1:55439`. Its credentials below are disposable test credentials. The harness creates a unique `campuspay_refresh_*` database and drops that database when finished; its Next.js server uses only the restricted test runtime role and newly generated test secrets.

For a new local test server:

```bash
docker run --name campuspay-refresh-test -e POSTGRES_PASSWORD=refresh-local-only -p 127.0.0.1:55439:5432 -d postgres:17
npx playwright install chromium
npm run build
npm run test:visual
```

If the QA container already exists, use `docker start campuspay-refresh-test` instead of creating it again. Set `TEST_POSTGRES_URL` to use another localhost test server. The harness refuses remote database hosts. The application test server and temporary databases are cleaned up after each run; the dedicated QA container can be stopped after local validation. The isolated Neon development branch remains available for review. Test connection credentials are excluded from Git.

## 20. Known limitations

- Physical RFID/NFC reader timing, printed card-number compatibility, and the E202 handover process still require real school hardware and operator verification. Keyboard-reader simulation is not hardware certification.
- New accounts intentionally start at ₩0. Enrollment cannot set a non-zero opening amount; funding must use the audited Accounting workflow.
- Cash is terminal/browser scoped, automatically ends at the configured timestamp, and may be disabled earlier. It is not a school-wide toggle or a reconciled cash drawer.
- Split payment supports one MICA Money wallet and one cash tender. Multiple student wallets are not supported.
- Browser recovery records use tab session storage. Closing the tab or clearing storage removes those client records; operators/students must consult authoritative history before starting a replacement operation. No PIN/card/session token is stored for recovery.
- The customer order quote is a review, not a reservation. Stock/coupon/wallet availability is revalidated on placement, and the storefront always supplies the reviewed total. The total field remains optional for older API clients.
- Fulfillment picking checks are local workflow assistance; committed state transitions and their immutable timestamps remain authoritative. Refreshing the page can reset unchecked local progress.
- East Building Floor 2 rooms 201–206 are orderable. West Building Floors 2–4 remain unavailable for delivery until rooms are configured.
- Customer order history is limited to 50 orders, the staff fulfillment queue to 200 orders, and wallet history to 100 transactions. This change does not add historical export or pagination.
- A formal full-site accessibility audit and every hardware/browser combination are outside the automated token, control, and representative-browser checks.

## 21. Deferred items

Full cash-drawer sessions, opening float, cash movements, counted closing cash, and variance reconciliation are deferred. The tender journal retains terminal/event/time information so these can be added without changing sales-channel semantics or counting wallet activity as drawer cash.

Customer cancellation/refund controls, multi-wallet splits, online self-registration, new student demographic fields, and arbitrary delivery-room entry were not added. Online self-registration is intentionally prohibited by the product brief. Refunds and other corrections require an explicit authorized financial operation instead of edits to historical journals.

Merging, deployment, and production migration execution are deliberately excluded from this delivery.

## 22. Manual verification and final review

Before a separately authorized live rollout:

1. Review the completed automated and screenshot evidence with the school operators; perform device-specific acceptance on the actual registers, tablets, and student phones.
2. At E202, use the real reader and an approved test card to verify enrollment capture, secure PIN entry/confirmation, printed-card sign-in, identity handover, replacement, and old-session revocation.
3. Confirm school staff understand terminal-scoped cash policy, event naming, automatic end times, early disabling, cash received versus applied revenue, change, and the same-request recovery workflow.
4. Review a wallet sale, cash sale, and the exact ₩12,000 split receipt against the ledger, tender rows, inventory/cost allocations, and report totals in an approved test environment. Repeat the ₩4,000 cash failure and inspect the unchanged financial state.
5. Verify the controlled East/West delivery directory and physical fulfillment route with school staff. Check picking, room/recipient/notes, delivery progression, and customer history refresh.
6. Review the six migration files, role grants, backfill/reconciliation constraints, application/database release ordering, and normal backup/rollback procedures through the school's separate rollout process.
