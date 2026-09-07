# Modernization audit — 7 September 2026

Starting main: `18aace8950820163974e6b1199db45bb16ae40ad` (fetched origin/main). Dedicated branch: `feat/campuspay-ui-ux-refresh`. Existing uncommitted generated `next-env.d.ts` dev-route references are preserved separately from the change.

Before implementation, `npm run validate`, `npm run validate:static`, `npm run build`, and the complete existing HTTP integration script passed against a fresh localhost PostgreSQL 17 container. Unit baseline: 6 files, 22 tests. Integration covered authentication/roles, wallet floor, replay, coupons, FIFO, stock receipts, accounting, reports, PIN elevation, immutable ledger, customer purchase/fulfillment and cashier idle expiry.

## Route and product findings

| Route / area | Baseline finding | Required change |
| --- | --- | --- |
| `/` | Sign-in shown even with a valid staff session; oversized gradient layout and access-model copy | Dedicated `/login`; authenticated home routes to permitted workspace |
| `/pos` | Guarded; no search/categories; card/PIN only; short-lived receipt; closing possible while confirming | Product discovery, persistent receipts, explicit tender plan and processing/retry states |
| `/orders` | Guarded queue but cards expose raw status values; no picking checklist or event timeline | Human labels, next valid action, delivery/picking detail |
| `/inventory` | Guarded; large always-open forms; missing product register and stock adjustment UI | Dense searchable product table, deliberate task selection, lot/stock visibility |
| `/accounting` | Guarded; no revenue/channel/tender overview or wallet history; weak adjustment busy states | Revenue reconciliation, wallet history, protected adjustment confirmation |
| `/coupons` | Guarded; sufficient terms, but technical storage copy, native prompt deactivation, UTC/local date mismatch | Plain labels, accessible confirmation, accurate local datetime input |
| `/security` | Guarded; step-up exists but token survives context changes; inventory-admin search incorrectly calls wallet-only API | Safe dedicated student lookup, expiry and selection reset, contextual credential actions |
| `/store` | Unguarded; loads public catalog and locations before session check | Server page/API/database authentication, MICA Money login + E202 instructions |
| `/store/orders` | Unguarded page; API itself correctly scopes orders to customer | Guard page, safe return destination, meaningful order detail/timeline |
| Students / reports / payment settings | Missing workspaces | Super Admin enrollment and terminal payment policy; financial reports |
| API routes | Thin validated handlers; restricted RPC registry; staff and customer use separate host-only cookies | Keep server authorization and runtime restrictions; close public store RPCs |

## Architecture and guarantees

The browser calls same-origin Next.js handlers and feature services. A fixed typed RPC registry parameterizes database calls. Private tables are inaccessible to the runtime role; narrow SECURITY DEFINER functions pin their search path. Sessions use distinct staff and customer token scopes. Staff roles are cashier, inventory_admin, accountant, super_admin; fulfillment is currently a permission assigned to existing operational roles, not a separate role.

Student fields are student_code, display_name and active: no grade/year field exists. Wallet, credential and card rows are separate. A unique card fingerprint and partial unique active-card index protect assignments. PINs are HMAC proofs hashed with bcrypt cost 12. Existing credential reset requires a student/purpose/session-bound, one-use, 60-second Super Admin elevation and revokes customer sessions.

POS and online settlement already lock wallet, coupon and inventory rows and record immutable wallet/inventory journals, sales lines, lot allocations and COGS in one transaction. Products share a stock pool with FIFO/LIFO costing. Wallet floor is −₩15,000. Sales channel already distinguishes POS and ONLINE_STORE, but sales/student balances and coupon redemptions currently assume a student; there is no tender model. Cash must make identity nullable without creating wallet activity, and coupons with per-student limits require identity. A normalized tender table with deferred reconciliation and one authoritative POS confirmation preserves these guarantees. Cash acceptance will be terminal-specific, off by default, Super Admin controlled and audited.

## UI, responsive and accessibility findings

Global CSS uses oversized headings, heavy shadows, large radii and an orange primary color with weak white-text contrast. Mobile staff navigation disappears below 1050px. Tables have unlabelled scroll areas; clickable wallet rows are not keyboard controls. Search fields lack labels. There is no shared dialog focus management, skeleton or error/retry pattern. Payment processing feedback and duplicate-click controls are inconsistent. Financial values need tabular figures and right alignment. Several screens swallow load errors as empty results. The largest original component is the 159-line storefront, but minified one-line components make maintenance difficult.

## Verification plan and isolation

Run migrations on fresh local PostgreSQL and an isolated Neon child of production (`dev-ui-ux-refresh-20260907`, `br-late-bread-azrpu2xh`); never apply to production. Add real transaction tests for exact split, insufficient cash, wallet/PIN/coupon/inventory failures, replay, concurrency and forced rollback. Add enrollment duplicate/rollback/authentication checks, customer/staff isolation, responsive browser checks at 1440, 1024, 768 and 390px, and screenshot review of major screens. Full drawer reconciliation is explicitly deferred; cash tender records retain event/terminal metadata for future reconciliation.
