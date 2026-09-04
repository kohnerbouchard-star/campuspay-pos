# CampusPay — modular school RFID/NFC POS with coupons

**Connection state: Supabase intentionally unconfigured.** This package contains the connection factories and database contract, but no Supabase project has been created, linked, migrated, queried, or modified. You will enter the connection values later.

## Included capabilities

- Employee ID and personal-PIN staff sign-in.
- Least-privilege workspaces for cashier, inventory administrator, accountant, and super administrator.
- Card-first, student-PIN-second checkout.
- Wallet balances permitted down to **−₩15,000**.
- Database-generated product buttons and sold-out state.
- Costed stock receipts, inventory lots, FIFO/LIFO allocation, COGS, and gross-profit reporting.
- Accountant-only denomination-based wallet adjustments with an immutable ledger.
- Hidden card identifiers represented by keyed fingerprints.
- Student PIN proofs and database hashes only; no readable PIN storage or response.
- One-use super-admin authorization for card and PIN resets.
- Twenty-second cashier inactivity lock enforced in the browser and server session layer.
- One coupon code per sale with fixed-won or percentage discounts.
- Coupon minimum spend, maximum discount, validity window, global limit, and per-student limit.
- Admin-only coupon creation and deactivation.
- Atomic coupon redemption with payment, wallet, FIFO/LIFO inventory allocation, and reporting.

## Architecture

```text
Role-specific Next.js UI
        │
        ▼
Narrow /api route handlers
        │
        ▼
Feature services and typed RPC adapter
        │
        ▼
Supabase/PostgreSQL connection factories
        │
        ▼
Your Supabase project — not configured yet
```

The browser never directly writes balances, stock quantities, coupon redemptions, credential records, or audit rows. Those mutations are designed to run through server-authorized PostgreSQL functions.

## Supabase connection placeholders

The connection layer is already separated into:

```text
src/lib/supabase/browser.ts
src/lib/supabase/server.ts
src/lib/supabase/admin.ts
src/lib/supabase/rpc.ts
```

When ready, copy `.env.example` to `.env.local` and enter your own values. Until then, do not run the connected application routes.

`npm run connection:check` performs an offline presence check only. It never contacts Supabase.

## Coupon flow

```text
Cashier enters coupon code
        │
        ▼
Server fingerprints code and quotes discount
        │
        ▼
Cashier opens payment intent with coupon
        │
        ▼
Student scans card and enters PIN
        │
        ▼
Database revalidates coupon for that student
        │
        ▼
Coupon redemption + sale + wallet debit + inventory/COGS commit together
```

The database stores a keyed coupon-code fingerprint and a masked code hint, not the reusable raw code. A cart change clears the browser quote, and final checkout recalculates eligibility independently.

## Local source validation

The static validation suite does not require a Supabase connection:

```bash
npm run validate:static
```

Full framework validation requires installing the pinned dependencies:

```bash
npm install
npm run typecheck
npm run test
npm run lint
npm run build
```

## Documents

- `docs/ARCHITECTURE.md` — module and transaction boundaries.
- `docs/API.md` — endpoint contracts.
- `docs/DATABASE.md` — tables, costing, wallet, and coupon records.
- `docs/SECURITY.md` — least privilege and credential controls.
- `docs/SUPABASE_CONNECTION_LATER.md` — deferred connection instructions.
- `docs/DEPLOYMENT.md` — later production checklist.
