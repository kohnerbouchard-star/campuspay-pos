# API surface

Endpoints accept JSON and enforce the appropriate staff or customer session.
Mutations validate their origin against the configured application surface.
Financial creation requests use each endpoint's `idempotencyKey` UUID in the body;
authentication and protected credential actions use their own session/token rules.

## Authentication

- `POST /api/auth/login` — employee code + staff PIN; creates a terminal-bound Neon/PostgreSQL application session.
- `POST /api/auth/logout` — revokes the app session and signs out.
- `GET /api/auth/session` — returns sanitized role/workspace data.
- `POST /api/auth/activity` — extends an active session after a recognized UI action.

## POS

- `GET /api/pos/catalog` — active products, selling price, stock status only.
- `POST /api/pos/intents` — server-prices a cart and creates a short-lived intent.
- `POST /api/pos/intents/:intentId/card` — accepts raw reader value, fingerprints it server-side, binds one student card, and immediately locks the reader intent.
- `POST /api/pos/intents/:intentId/confirm` — masked PIN verification and atomic checkout.

## Inventory

- `GET|POST /api/inventory/products` — list or create product.
- `POST /api/inventory/products/:productId/price` — controlled price change with reason.
- `POST /api/inventory/receipts` — costed stock receipt; only supported positive-stock path.
- `POST /api/inventory/adjustments` — damage, expiration, supplier return, or count loss; negative only.
- `GET /api/inventory/lots` — lot quantity, cost, receipt, and expiry.

## Accounting

- `GET /api/accounting/students?q=` — accountant-only student search and balance/debt summary.
- `POST /api/accounting/intents` — creates a denomination-based adjustment intent.
- `POST /api/accounting/intents/:intentId/card` — verifies the selected student’s card first.
- `POST /api/accounting/intents/:intentId/confirm` — verifies student PIN and posts one immutable ledger entry.

## Reports

- `GET /api/reports/sales`
- `GET /api/reports/inventory`
- `GET /api/reports/wallets`

## Security

- `POST /api/security/step-up` — verifies a separate super administrator and creates a one-use token.
- `POST /api/security/students/:studentId/pin-reset` — consumes purpose-bound authorization and stores a new student-entered PIN hash.
- `POST /api/security/students/:studentId/card-reset` — consumes purpose-bound authorization, deactivates the old card, and stores only a fingerprint of the new scan.


## Customer store

- `GET /api/store/catalog` — customer-authenticated active catalog, prices, and shared stock status.
- `GET /api/store/locations` — customer-authenticated East/West delivery directory.
- `POST /api/store/login` — printed card number + student PIN; creates a customer-only session.
- `GET /api/store/session` — sanitized customer identity and current wallet balance.
- `POST /api/store/logout` — revokes the customer session.
- `POST /api/store/quote` — reviews `items` and optional `couponCode`; returns current subtotal, discount, total, and projected wallet balance without settling payment.
- `GET /api/store/orders` — the signed-in student's order items, room delivery details, and actual append-only status-event timeline.
- `POST /api/store/orders` — atomic wallet-only checkout with `items`, optional `couponCode`, `deliveryLocationId`, optional `deliveryNote`, and required `idempotencyKey`. The optional nonnegative integer `expectedTotalWon` rejects a changed reviewed total with `CONFLICT`; the storefront always supplies it.

Only login is available without a customer session; logout can safely clear an
absent session. A staff session does not authorize customer catalog, directory,
quote, account, or order access. There is no self-registration API.

Retry an uncertain order with the same UUID and unchanged proposal. A completed
request returns its original receipt for that student. The storefront retains
the pending proposal/key in student-scoped tab storage across reauthentication;
it does not store PINs, raw card numbers, or session tokens. See
[ONLINE_STORE.md](ONLINE_STORE.md) for browser-recovery limits and customer pages.

## Online fulfillment

- `GET /api/orders` — staff fulfillment queue (`orders.fulfill`), including item details and actual status-event timestamps.
- `POST /api/orders/:orderId/status` — advances the controlled fulfillment state machine.
