# MICA Money student store

MICA Money is the customer-facing student store. It shares CampusPay's wallet,
inventory, coupon, costing, tender journal, and audit engine with the staff POS.
The entire storefront requires a customer session before it exposes products,
prices, stock availability, delivery locations, cart, wallet, or order history.

## Separate surfaces

Production should configure two HTTPS origins:

- `STAFF_ORIGIN` — staff register/operations URL, for example `https://pos.school.example`.
- `STORE_ORIGIN` — customer store URL, for example `https://store.school.example`.

The application uses separate host-only staff and customer cookies. A customer
session cannot authorize staff endpoints, and a staff session cannot authorize
customer endpoints. Configured dedicated hosts restrict access to the appropriate
surface. In local development both surfaces use one Next.js instance: `/store` is
the student store and `/orders` is the staff fulfillment queue.

## Customer pages and access

| Route | Purpose | Access |
| --- | --- | --- |
| `/store/login` | MICA Money card/PIN sign-in and E202 instructions | Public sign-in page |
| `/store` | Product browsing, cart, delivery selection, and checkout review | Customer session required |
| `/store/orders` | The student's order history and delivery timeline | Customer session required |
| `/store/account` | Wallet balance, debt, and card/PIN support | Customer session required |

On a dedicated store host, `/`, `/orders`, and `/account` map to the corresponding
customer pages. Unauthenticated requests redirect to `/store/login` with an
allowlisted intended destination. Expired sessions return to sign-in with an
explanation. After successful authentication, the student returns to the intended
page. Page guards, HTTP endpoints, and database catalog/delivery RPCs all enforce
customer authentication; possessing a staff session does not grant access.

There is no online registration. Students without a MICA Money Card are directed
to **E202** to register and activate a physical card. The “How to get a MICA Money
Card” action provides information only. Super Admin enrollment is documented in
[STUDENT_ENROLLMENT.md](STUDENT_ENROLLMENT.md).

## Customer authentication

Students sign in with the number printed on their MICA Money Card and their
existing 4–12 digit PIN. Server code normalizes and fingerprints the card number
before database lookup; raw card numbers are not stored in the database. Student
PINs continue to use the keyed proof plus slow `pgcrypto` hash model. The sign-in
page masks the PIN and uses a generic credentials error that does not identify
whether the card or PIN was incorrect.

Customer sessions use an opaque cookie and a 15-minute idle timeout, capped at
eight hours. Three failed PIN attempts trigger the existing student credential
lock, while repeated attempts from one network address are also rate-limited
using a one-way IP fingerprint. Card replacement and PIN reset immediately revoke
existing customer sessions. Staff credential-reset protections remain in force.

## Delivery directory

Initial delivery locations are:

- East Building — Floor 2 — Rooms 201, 202, 203, 204, 205, 206 (orderable).
- West Building — Floors 2, 3, 4 (visible but not orderable until room numbers are configured).

Orders snapshot the building, floor, and room so historical delivery records remain accurate after directory changes.

## Order transaction

Checkout has two explicit steps. `POST /api/store/quote` reviews the selected
items and optional coupon against current prices, stock, coupon rules, and the
wallet floor. It returns subtotal, discount, total, and the projected wallet
balance without settling a purchase. The student reviews that result and the
chosen building, floor, room, and recipient before placing the order.

The browser sends the reviewed total as `expectedTotalWon` to
`POST /api/store/orders`. This integer field is optional for existing API clients;
the new storefront always supplies it. Settlement rejects a changed total with
`CONFLICT` so the student can review the current price. A quote neither
reserves stock nor guarantees later coupon availability.

Placing an order is one PostgreSQL transaction. It locks product prices before
pricing, rechecks any coupon under a lock, verifies the shared **−₩15,000** wallet
floor, and allocates the same FIFO/LIFO inventory lots used by the physical POS.
The transaction calculates COGS and writes the sale, wallet tender, wallet ledger
when the amount is nonzero, coupon redemption, order items, initial status event,
and audit event together. Failure rolls back the entire settlement.

Online orders receive `WEB-YYYYMMDD-NNNNNN` numbers and sales are tagged
`ONLINE_STORE`. They always use a `WALLET` tender; cash and split payments are
staff POS features only. Physical register sales retain the `POS` sales channel.
Tender totals reconcile to the completed sale through the shared database
constraints described in [PAYMENTS.md](PAYMENTS.md).

## Idempotency and uncertain responses

Every order submission includes an `idempotencyKey` UUID. Repeating that key for
the same student returns the original order receipt rather than charging again.
A key belonging to another student is rejected. Clients must keep the same key
and unchanged proposal while resolving an uncertain response.

Before submitting, the storefront saves the reviewed proposal and key in the
current tab's `sessionStorage`, scoped to the signed-in student's ID. That record
contains no PIN, raw card number, or authentication token. If browser storage
cannot be prepared, checkout does not begin. A confirmed receipt clears the
pending record; a lost response or server error retains it and offers a safe
retry. A later authentication error cannot establish that the earlier request
failed, so the pending key survives reauthentication in the same tab for the same
student. Another student's account does not restore that proposal.

The student can also check **My orders** before attempting a new purchase. Closing
the tab or clearing browser storage removes this browser recovery record; order
history remains the authoritative way to check completed purchases. A failed
catalog or wallet refresh after a successful payment does not replace its receipt
with a failed-payment message.

## Fulfillment

Staff with `orders.fulfill` use the `/orders` workspace. The supported progression is:

`PLACED → PICKING → READY → OUT_FOR_DELIVERY → DELIVERED`

Customer order details and the staff fulfillment detail show timestamps from the
actual append-only status events. Future stages do not receive invented completion
times. The staff queue supports status filters, student/order/room search, and
controlled progression to the next stage.

Customer cancellation and refund controls are not implemented. Refunds require an
explicit correcting transaction rather than editing financial or status history.

## API and migration

The authenticated catalog, delivery directory, quote, history, and checkout
contracts are listed in [API.md](API.md). The store changes are in
`database/schema/015_store_experience.sql` and the versioned migration
`database/migrations/20260907130000_store_experience.sql`.
