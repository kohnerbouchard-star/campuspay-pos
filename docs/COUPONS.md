# Coupon feature

## Scope

CampusPay supports one order-level coupon code per sale. The cashier may enter a code, but the browser cannot determine or finalize the discount by itself.

Supported discount types:

- Fixed Korean-won amount.
- Percentage discount represented in basis points for integer-safe calculation.

Supported controls:

- Minimum order subtotal.
- Optional maximum discount for percentage coupons.
- Start date and time.
- Optional expiration date and time.
- Optional overall redemption limit.
- Optional per-student redemption limit.
- Active/inactive state.
- Admin deactivation with a logged reason.

## Least-privilege behavior

### Cashier

A cashier can:

- Enter a coupon code on the active cart.
- Request a non-binding discount quote.
- Remove the coupon before checkout.
- See the masked coupon hint and discount amount.

A cashier cannot:

- Create, modify, or deactivate coupons.
- Override a coupon's dates, minimum order, or use limits.
- Enter an arbitrary discount amount.
- change the server-calculated final total.
- View the stored coupon fingerprint.

### Inventory administrator

An employee with `coupon.manage` can:

- Create a coupon.
- View issued coupon summaries and aggregate use.
- Deactivate an active coupon with a reason.

Coupon definitions are immutable after creation. An incorrect coupon is deactivated and replaced rather than edited, preserving the audit trail.

### Accountant/reporting role

An employee with `reports.coupons` can view coupon-redemption totals and discount impact without gaining coupon-creation authority.

## Checkout sequence

```text
1. Cashier selects products.
2. Cashier enters a coupon code.
3. API returns a preliminary quote based on the current cart.
4. Any cart change clears that quote.
5. Cashier creates the payment intent with the coupon code.
6. Server fingerprints the code and recalculates the current subtotal.
7. Student scans the card.
8. Student enters the PIN.
9. Final database transaction identifies the student.
10. Database locks and rechecks the coupon.
11. Database enforces global and per-student limits.
12. Discount, sale, wallet debit, inventory allocation, COGS, and redemption commit together.
```

The preliminary quote is for display only. Final eligibility is checked again inside the same transaction that completes the sale.

## Code privacy

The raw reusable code is never stored in the coupon table. Server code:

1. Normalizes the code by removing spaces/hyphens and converting to uppercase.
2. Computes a keyed HMAC fingerprint using `COUPON_HMAC_SECRET`.
3. Sends only the fingerprint and a masked hint to PostgreSQL.

Example:

```text
Entered code: WELCOME10
Stored hint:  ••••ME10
Stored key:   HMAC fingerprint, not WELCOME10
```

The code entered during checkout is masked from reporting and audit interfaces. The coupon HMAC secret must remain server-only and must be different from the card and session secrets.

## Discount calculation

All amounts use integer won.

Fixed coupon:

```text
discount = min(fixed amount, subtotal)
```

Percentage coupon:

```text
discount = floor(subtotal × percentage basis points ÷ 10,000)
```

When a maximum discount exists:

```text
discount = min(calculated percentage discount, maximum discount)
```

The final total never becomes negative:

```text
final total = max(0, subtotal − discount)
```

A fully discounted sale is permitted, but it does not create an unnecessary zero-value wallet movement.

## Database records

The coupon module adds:

- Coupon definitions using code fingerprints.
- Coupon-redemption ledger records linked to student and sale.
- Coupon references and discount snapshots on payment intents and sales.
- Narrow RPC functions for quote, creation, deactivation, reporting, and final redemption.

Historical sales retain their original subtotal, discount, and final total even after the coupon is deactivated.

## Supabase state

The coupon SQL exists only as the local module `supabase/schema/008_coupon_functions.sql`. It has not been applied to a Supabase project. See `SUPABASE_CONNECTION_LATER.md`.
