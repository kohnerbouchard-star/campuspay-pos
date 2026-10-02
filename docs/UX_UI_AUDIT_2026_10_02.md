# CampusPay UX/UI audit — 2 October 2026

## Scope and evidence

Baseline: deployed source commit `4d660fd4af0ab9caabe1cce5331e4ec90f59f480`, tree `1b04ad78432ea92a0ebdb1fd46295ae442c58ebc`. The run-102 artifact was downloaded and its SHA256 independently verified as `0163c7d3c66d2dd1a857c9f8b1bdd5e88c3c7c6a29daa318ffa28d2cf7732643`; its archived source produces the same Git tree.

This is a source-and-browser-evidence usability audit, not a usability study with school staff or students. The route inventory covers all 23 page entries: 17 staff workspaces/detail pages, three authenticated customer pages, two login pages and the role-based root redirect. Representative archived screenshots cover the main workspaces, desktop/mobile layouts, enrollment, refunds, cash operations and error recovery. New automated route and navigation checks are in `scripts/verify-navigation-ux.mjs`; their results, screenshots and failure evidence are archived by CI. A new test is not a passed test until its exact candidate workflow succeeds.

Live CampusPay deployment listing remains denied by the Vercel connection (403). No independent live authenticated browsing, live production error scan, real card-reader test, staff usability trial or full WCAG conformance claim is made. Mutation tests in the existing suite use disposable localhost PostgreSQL, never school accounts. This usability patch does not install the separate database work in PRs #33/#34.

## Overall finding

The core interface already has useful foundations: permission-filtered workspaces, clearly labeled payment actions, native dialogs, server-backed financial operations, loading/error states, and explicit warnings for unconfirmed results. The main usability problem is finding the correct workflow and retaining context, rather than a need to replace the entire visual identity.

The staff menu has fourteen peer destinations. On smaller screens it becomes a single horizontal strip, exposing only its first few links without a strong indication that later workspaces exist. Accounting, funding, cash-register and reporting destinations require domain knowledge to distinguish. Selection is driven by a page-title comparison, so cash-close history, item refunds and enrollment-completion pages lose their parent highlight. Long report screens and six equally weighted inventory task buttons make scanning harder.

## Implemented in this navigation/usability patch

| Finding | Change | Verification required |
| --- | --- | --- |
| Fourteen undifferentiated staff destinations | Four consistent groups: Daily work; Students & money; Reporting; Administration. Empty groups are omitted for each role. | Exact route-set comparison for all four roles. |
| Mobile destinations hidden in horizontal scrolling | Labeled Menu button opens a full, vertically scrollable native dialog with task descriptions. | Keyboard loop, Escape, focus restoration, route selection, mobile layout and breakpoint-resize checks. |
| A long desktop menu can crowd the account/sign-out area | Independently scrollable navigation with a separate account footer and readable role names. | Short-laptop-height reachability and sign-out visibility. |
| Current workspace inferred from a display title | Route-boundary matching, including a parent location indicator for nested pages. | Exact, trailing-slash, nested, unauthorized and false-prefix unit tests. |
| No consistent return path from nested workflows | Visible breadcrumbs and explicit links back to Students, Cash drawer and Refunds & returns. | Nested-route crawl and keyboard-focus checks. |
| Financial and access labels are difficult to distinguish | Descriptive navigation labels: Wallets & accounting; Wallet funding; Cash drawer; Refunds & returns; PIN & card access; Staff & registers. Existing routes remain unchanged. | Same authorized destinations; no new permissions or redirects. |
| Reports form a long scroll with little orientation | Permission-filtered report jump links with focusable targets. | Every visible shortcut resolves to its report and moves keyboard focus. |
| Browsing stock and changing stock appear at the same level | Inventory separates Browse stock from Manage stock; removes the duplicated Receive stock control. | Both browsing views and all four action views remain reachable. |
| Dedicated store aliases can lose their selected navigation state | `/`, `/orders` and `/account` normalize to the existing customer destinations for display only. | Alias helper tests; customer navigation remains separate from staff routing. |
| Store header shows a number without an explicit balance label | Adds Wallet balance and makes the existing content skip target programmatically focusable. | Store desktop/mobile layout and skip-link checks. |
| Event-status border references an undefined design token | Uses the existing `--line` token instead of `--border`. | Production CSS/build and existing visual regression checks. |

The patch intentionally preserves role-specific login landing pages. Cashiers still enter point of sale directly; they do not have to cross a new dashboard. All existing authentication, API permissions, feature activation gates, money movements, credential approval, card scanning and transaction recovery rules remain in place. No global keyboard shortcuts or new navigation-search input are added that could compete with the keyboard-wedge card reader.

## Screen-by-screen audit

| Page | Primary task and current usability concern | Current disposition |
| --- | --- | --- |
| `/` | Route the signed-in staff member to their normal working page. | Preserve and test role-based redirect. |
| `/login` | Staff sign-in using employee credentials. Surface must not be confused with student sign-in. | Preserve isolated login and existing error recovery. |
| `/pos` | Add items, choose tender and settle once. Mobile cart follows the product list; navigating away discards an unsubmitted cart. | Shared navigation improved; mobile cart access and draft lifecycle need a separate change. |
| `/orders` | Prepare and deliver student orders. Filters and live refresh are useful; picking checkboxes are explicitly page-local. | Navigation improved; durable picking requires server-side concurrency and audit work. |
| `/inventory` | Browse products/lots and perform authorized stock tasks. Six peer task buttons and duplicate receiving action add clutter. | Browse/manage grouping implemented; product-specific actions and draft persistence remain follow-up. |
| `/coupons` | Create and administer discounts. Long form combines many optional limits and timing fields. | Navigation improved; progressive disclosure and a clearer final review remain follow-up. |
| `/students` | Find an existing student, inspect access, or enroll a genuinely new account. Card-only accounts are not explained or recoverable cleanly in the deployed baseline. | Navigation improved; credential-state repair belongs to the separately tested database lifecycle work. |
| `/students/[studentId]/complete` | Issue initial credentials on an existing roster entry. Identity checks and explicit issuance are necessary. | Parent navigation/return link implemented; no weakening of issuance gates. |
| `/accounting` | Review wallets and adjust balances, with an additional sales view. It overlaps with funding and reports; tabs are page-local. | Clearer navigation label; consolidation must respect installed funding controls. |
| `/funding` | Record controlled funding/cash operations. Terminology and disabled-feature states can make the correct entry point unclear. | Task description and grouping improved; install-readiness and guided operation choice remain follow-up. |
| `/cash` | Open/count/close a drawer. Users can confuse it with point of sale or general accounting. | Cash drawer label and description implemented; guided end-of-day sequence remains follow-up. |
| `/cash/history` | Find past drawer closes. Previously no selected parent navigation. | Parent highlight and explicit return link implemented. |
| `/refunds` | Find the original sale, review a full refund/return and cash handover. The distinction from item refunds is easy to miss. | Refunds & returns labeling and grouping improved; one clear full-versus-item entry flow remains follow-up. |
| `/refunds/items` | Inspect remaining refundable quantities and all related receipts. Previously loses parent selection. | Correct parent highlight/return link; financial decision logic unchanged. |
| `/reconciliation` | Find discrepancies and compare journals. The screen exposes necessary accounting detail but the next operational action is not always obvious. | Reporting grouping improved; exception-led summary and guided resolution remain follow-up. |
| `/reports` | Inspect/export authorized data. Multiple long panels make later reports hard to find. | Jump links and context implemented without hiding reports or removing filters. |
| `/security` | Obtain approval to reset a PIN or replace a card. Generic Security label hides the actual task. | PIN & card access label/description; PR #35 approval and uncertainty handling preserved. |
| `/administration` | Manage staff accounts and registered terminals. Two large directories and generic role/terminal terminology add cognitive load. | Staff & registers label and readable role names in navigation; directory redesign remains follow-up. |
| `/settings/payments` | Control event/cash acceptance for the current register. This is not a global school-wide switch. | Explicit register-specific task description; activation controls unchanged. |
| `/store/login` | Student card/PIN sign-in and help. Keep staff authentication entirely separate. | Preserve; no automatic credential changes or cross-surface login link. |
| `/store` | Browse, add to cart, select delivery and place an order. Mobile cart positioning and draft loss across navigation deserve separate treatment. | Balance label and navigation/skip improvements; checkout safety unchanged. |
| `/store/orders` | Track delivery and inspect purchases. The read model limits recent history and has no user-controlled older-page navigation. | Selection fixed; real server-backed pagination remains outstanding. |
| `/store/account` | Understand wallet position and get card/PIN help. Negative balance and remaining spending capacity must not be conflated. | Balance labeling and selection improved; no new credit policy or invented totals. |

## Remaining work, in priority order

### 1. Finish the account and financial lifecycle repairs

A more polished menu must not conceal missing-credential dead ends, uncertain stock removals, or receipt consistency problems. Reconcile overlapping PRs #33/#34 with the deployed API/Security release; validate their migrations and underlying workflows before changing the UI to imply the functions are ready. Do not let Reset PIN become accidental first issuance. Keep production tracker #4 open.

### 2. Preserve task state without persisting sensitive input

Back, refresh and workspace changes should not silently discard harmless search/filter selections or an unsubmitted product selection. Design a bounded draft lifecycle, scoped to the operator/student and installation. Persist only approved non-sensitive identifiers/quantities where appropriate, with schema validation, expiry and explicit discard. Never persist PINs, raw card reads, elevation tokens, or raw delivery notes as a convenience feature. Unconfirmed transactions must retain their existing separate recovery state rather than becoming ordinary drafts.

### 3. Make stock work product-centered and fulfillment durable

From a product row, offer only permitted actions for that product: inspect lots, receive stock, change its price, or remove stock. Keep destructive review and unknown-outcome recovery. Persist picking progress on the server with operator identity, version checks and an order lifecycle; a browser-only checkbox is not shared warehouse state. Implement real customer/staff history pagination instead of disguising capped lists as complete history.

### 4. Guide accounting and end-of-day work

Differentiate wallet lookup, cash-backed deposits, non-cash corrections, refunds, physical cash handover and drawer closing at the point of entry. Show applicable installation prerequisites without hiding recovery or history. Present reconciliation exceptions first, link to the relevant workflow, and retain the detailed journal data and export auditability. Do not automatically adjust a ledger merely to make a discrepancy disappear.

### 5. Verify with actual operators and devices

After deployment, observe a cashier taking a sale, an inventory operator receiving stock, an administrator resolving a student access issue, and a student placing/tracking an order. Test school tablets, browser zoom, the actual reader and network interruption. Record wrong turns, abandoned steps and whether users understand the distinction between confirmed rejection and unknown result. No measured speed or error-rate improvement is claimed by this heuristic audit.

## Accessibility and design basis

The navigation uses ordinary links, not application-menu ARIA roles; current-page/location state and a modal disclosure are explicit. New navigation controls target at least 44 CSS pixels in height, use visible focus indicators and keep keyboard access to off-screen links. Breadcrumb and report anchors preserve accessible target focus. These are targeted improvements, not a claim of whole-app WCAG certification.

Primary references: W3C APG disclosure navigation example (`https://www.w3.org/WAI/ARIA/apg/patterns/disclosure/examples/disclosure-navigation/`); WCAG 2.2 Target Size Minimum (`https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum`); Focus Not Obscured Minimum (`https://www.w3.org/WAI/WCAG22/Understanding/focus-not-obscured-minimum`). Their minimum requirements should not be confused with this patch's 44-pixel design target.

## Release boundary

This is an application-only presentation/navigation change. No database migrations, credentials, balances, feature switches, hosting secrets, domain assignments or payment calculations are modified. Existing financial, security, browser and restore suites remain enabled. The native navigation test suite adds 47 cases; the additional browser suite inventories 23 routes and checks four staff roles plus the separate student store. Exact CI status and release commit must be recorded on the PR after execution; do not treat this document as evidence of deployment.
