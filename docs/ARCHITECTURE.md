# Architecture

## Runtime boundaries

```text
RFID/NFC reader → Next.js UI → same-origin API route → feature service
                                               ↓
                                 whitelisted PostgreSQL adapter
                                               ↓
                                      Neon api.* function
                                               ↓
                                private transactional data model
```

The browser never receives `DATABASE_URL` and never queries PostgreSQL directly. UI components cannot import `src/lib/db/client.ts`. API routes authorize the current terminal session and pass only validated inputs to domain services.

Each financial mutation is implemented as one PostgreSQL function so wallet, sale, inventory, coupon, COGS, and audit records commit or roll back together.

## Modules

- `src/features/auth` — employee PIN authentication and role permissions.
- `src/features/pos` — cart, card scan, payment, and receipt flow.
- `src/features/inventory` — products, prices, receipts, lots, and adjustments.
- `src/features/wallets` — controlled denomination-based credits and deductions.
- `src/features/coupons` — creation, validation, redemption, and reporting.
- `src/features/security` — one-use super-admin authorization for credential reset.
- `src/lib/db` — server-only connection, normalization, and RPC whitelist.

## Portability

The frontend depends on CampusPay `/api` contracts rather than Neon directly. Moving to another PostgreSQL provider requires changing the connection adapter and environment, not rewriting the role-specific UI.
