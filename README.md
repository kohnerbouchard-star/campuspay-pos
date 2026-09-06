# CampusPay — school RFID/NFC POS, wallet, and online store

CampusPay is a closed-loop school wallet, point-of-sale, and room-delivery online-store application built with Next.js and Neon Postgres. The browser talks only to same-origin API routes; all financial, inventory, credential, and coupon mutations execute through narrowly scoped PostgreSQL functions.

## Included capabilities

- Employee-code and personal-PIN sign-in with cashier, inventory-admin, accountant, and super-admin roles.
- Card-first, student-PIN-second checkout.
- Wallet balances permitted down to **−₩15,000**.
- Product buttons generated from database records and automatic sold-out state.
- Costed stock receipts, inventory lots, FIFO/LIFO allocation, COGS, and gross-profit reporting.
- Accountant-only denomination-based wallet adjustments with an immutable ledger.
- HMAC-fingerprinted card and coupon identifiers; raw identifiers are not stored.
- One-use super-admin authorization for student card and PIN resets.
- Twenty-second cashier inactivity lock enforced by the UI and database session.
- Fixed-won and percentage coupons with validity, minimum spend, caps, and redemption limits.
- Customer online store using printed RFID/card number + student PIN.
- Shared POS/online inventory, wallet, coupons, FIFO/LIFO costing, COGS, and sales ledger.
- East Building room delivery (201–206) plus West Building floors ready for room configuration.
- Staff online-order fulfillment: placed, picking, ready, out for delivery, delivered.
- Optional production host separation with `STAFF_ORIGIN` and `STORE_ORIGIN`.

## Architecture

```text
Role-specific Next.js UI
        ↓
Same-origin /api routes
        ↓
Feature services
        ↓
Whitelisted PostgreSQL RPC adapter
        ↓
Neon Postgres api.* functions
        ↓
Private tables, ledgers, lots, and audit records
```

## Local setup

```bash
git pull
npm install
cp .env.example .env.local
# Fill DATABASE_URL and application secrets in .env.local
npm run connection:check
npm run dev
```

Open `http://localhost:3000`.

Never commit `.env.local`. Use the pooled Neon connection string for normal application traffic and the direct connection only for schema migration tooling.

## Validation

```bash
npm run db:migration:build
npm run validate:static
npm run typecheck
npm run test
npm run lint
npm run build
npm run db:health
```

## Source layout

- `src/app` — pages and route handlers.
- `src/features` — domain modules and role-specific UI.
- `src/lib/db` — Neon connection and whitelisted RPC adapter.
- `database/schema` — ordered PostgreSQL source modules.
- `database/migrations` — deployable combined migration.
- `docs` — architecture, security, API, and operating documentation.

## Existing CampusPay Neon installation

The hosted CampusPay database has already been migrated and initialized. Do not run bootstrap or regenerate the application peppers for that installation. Place the separately supplied `.env.local` beside `package.json`, then run:

```bash
npm ci
npm run connection:check
npm run db:health
npm run dev
```

Use the credentials delivered separately to the owner. They are not stored in this repository.

## Empty development installation only

Use an owner direct `DATABASE_URL_UNPOOLED` for `npm run db:migrate`. The application uses a separate pooled `DATABASE_URL` restricted to the `campuspay_runtime` role. `ALLOW_DEMO_BOOTSTRAP=true npm run db:bootstrap-demo` initializes an empty development database with random demo PINs displayed once in your terminal. It refuses to run after credentials exist. Do not use it on real school data.

Neon supplies the database, not offline checkout. Purchases require a working connection. This is a development/pilot release, not a certification for unattended live financial operation.


## Online store

Local development exposes the customer store at `http://localhost:3000/store` and staff fulfillment at `http://localhost:3000/orders`. Production should configure separate HTTPS origins for customers and staff. See `docs/ONLINE_STORE.md`.
