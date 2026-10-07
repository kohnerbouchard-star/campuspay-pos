# Checkout/store consistency qualification

Base: `4e55ece88cb0afcc3e85c8f0436f8d346f5c40a1` (PR #42). Branch: `fix/checkout-store-consistency-20261007`.

This is a separate draft review. Do not merge or deploy it, change maintenance, execute a hosted migration, or alter production access. PR #42 and its qualified source remain unchanged. Student selection, employee access, Add Funds, global styling and their existing tests are owned elsewhere; this branch does not modify them. Existing migration, release, dependency and validation files are unchanged. The only new deployment configuration is a deny-only Vercel rule for this exact fix branch; all other branches are unspecified/unchanged.

## Implementation

- One reducer owns the cart revision and coupon request identity. Quantity/product/catalog changes invalidate prior quotes. Replacing or clearing the coupon invalidates in-flight responses. A pending or failed current calculation blocks payment until retried or explicitly cleared. The server still reprices the intent and confirms the payment.
- Both normal and recovered POS completion use the existing `recover_payment_intent` API to retrieve immutable `sale_items` snapshots. No catalog fallback or fabricated adjustment is printed. A known approval whose receipt fetch fails retains its intent reference and a recovery-only state; it is never treated as a payment rejection. No schema/RPC/permission change is required. Existing discounts, won rounding, tenders, cash change and refunds are not recalculated. This schema has no separate tax fields; no tax logic is introduced or removed.
- The shared quantity constant remains 99 in server validation and bounds client quantities to `min(stock, 99)`. Direct input, Enter/blur, Escape, increment/decrement, removal and refreshed-stock reconciliation use the same bound. Scoped CSS and accessible labels explain the limit without changing global styles.
- Store quote/place/recovery calls have a 30-second transport deadline covering fetch and body parsing. Timeout is an unknown outcome, not a confirmed rejection. No automatic resubmission occurs. The pre-existing opaque student/request reference stays in sessionStorage across reload/sign-in; checkout and editing are unavailable until original-key recovery confirms the result. Late responses cannot settle the operation twice or update an unmounted/replaced operation. Confirmed null recovery uses the existing server tombstone; it is not inferred from timeout.

## Required evidence

`node --experimental-strip-types --no-warnings --test scripts/checkout-store.test.mjs` runs dependency-free transport/reducer/quantity/receipt regressions. `src/features/pos/checkout-validation.test.ts` exercises the unchanged Zod server bound under the normal unit suite.

`CI=true node scripts/verify-checkout-store.mjs` requires the production build, Chromium and the existing localhost-only disposable `refundTestContext`. It creates random synthetic identities and its own database, exercises delayed/reordered coupons, price changes with normal/recovered/receipt-read-loss completion, numeric bounds/stock refresh, stalled store placement/recovery, reload, late responses, same-key concurrency and native orders/sales/ledger/stock assertions. It records desktop/phone screenshots and `results.json` under `.validation/checkout-store/`. It never accepts a hosted database.

The new checkout-only workflow checks out the exact PR head, checks the localhost target and runs the original core gates plus native access and all five original browser/integration regression groups without editing their harnesses. Checkout/store acceptance is a sixth regression group. Actions are pinned; workflow permissions are read-only; no secrets, deploy jobs or release tooling are used. All database setup is isolated synthetic CI setup, not approval for migration execution elsewhere.

Final commit SHA, exact-head run links, passed/failed/unrun checks and inspected screenshot evidence are recorded in the draft PR body after execution. Earlier qualified-base artifacts and the first 36 passing local tests are not substitutes for final-head qualification. Local dependency installation encountered registry DNS/cache failures, so complete package-dependent validation must be attributed to CI rather than claimed as a local pass.

## Review boundaries

This does not certify all application behavior or authorize release. Receipt details require an additional server read and remain recoverable when that read is unavailable. References retain the existing same-browser/sessionStorage lifetime; closing/clearing the browser is not equivalent to reload. Per-tab recovery does not add a new cross-tab/cart deduplication protocol. Server idempotency and recovery fences remain authoritative and unchanged. New-head checks are required after any further code change or integration with another branch.
