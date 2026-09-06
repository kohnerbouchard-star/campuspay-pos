# CampusPay online store

CampusPay v0.9 adds a customer-facing student store that shares the existing wallet, inventory, coupon, costing, and audit engine with the staff POS.

## Separate surfaces

Production should configure two HTTPS origins:

- `STAFF_ORIGIN` — staff register/operations URL, for example `https://pos.school.example`.
- `STORE_ORIGIN` — customer store URL, for example `https://store.school.example`.

The application uses different staff and customer cookies. A customer session cannot authorize staff endpoints and a staff session cannot authorize customer order endpoints. In local development the storefront remains available at `/store` and staff fulfillment at `/orders`.

## Customer authentication

Students sign in with the card number printed on the RFID/NFC card and the existing student PIN. The card number is an identifier, not a password. Server code normalizes and HMAC-fingerprints it before database lookup; raw card numbers are not stored. Student PINs continue to use the keyed proof plus slow `pgcrypto` hash model.

Customer sessions use a separate opaque cookie and a 15-minute idle timeout, capped at eight hours. Three failed PIN attempts trigger the existing student credential lock, while repeated attempts from one network address are also rate-limited using a one-way IP fingerprint.

## Delivery directory

Initial delivery locations are:

- East Building — Floor 2 — Rooms 201, 202, 203, 204, 205, 206 (orderable).
- West Building — Floors 2, 3, 4 (visible but not orderable until room numbers are configured).

Orders snapshot the building, floor, and room so historical delivery records remain accurate after directory changes.

## Order transaction

Placing an order is one PostgreSQL transaction. It re-prices the cart, locks and rechecks any coupon, verifies the shared wallet floor, allocates the same FIFO/LIFO inventory lots used by the physical POS, calculates COGS, writes the sale, wallet ledger, coupon redemption, order items, and audit event, and then commits together.

Online orders receive `WEB-YYYYMMDD-NNNNNN` numbers and sales are tagged `ONLINE_STORE`. Physical register sales remain `POS`.

## Fulfillment

Staff with `orders.fulfill` use the `/orders` workspace. The supported progression is:

`PLACED → PICKING → READY → OUT_FOR_DELIVERY → DELIVERED`

Status events are append-only. The initial release intentionally does not expose customer cancellation/refund controls; refunds should be added as explicit correcting transactions rather than destructive edits.
