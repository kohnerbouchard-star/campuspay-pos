# Architecture

## Runtime boundaries

```text
RFID/NFC reader
      │ UID + Enter (only while a reader intent is active)
      ▼
Next.js role-specific UI
      │ JSON over same-origin /api routes
      ▼
Route handler
  ├─ validates payload with Zod
  ├─ validates Supabase identity
  ├─ validates signed terminal and opaque staff session
  ├─ requires exactly one permission
  └─ fingerprints card UID before persistence
      │ caller-scoped RPC
      ▼
Supabase Postgres
  ├─ role/session checks repeated in SQL
  ├─ row locks
  ├─ wallet-floor check
  ├─ FIFO/LIFO lot allocation
  ├─ sale, ledger, stock and audit writes
  └─ one atomic commit or full rollback
```

## Module map

```text
src/features/auth          staff login and session contracts
src/features/terminal      reader and inactivity behavior
src/features/pos           catalog, cart, payment intent and checkout UI
src/features/inventory     products, receipts, lots, adjustments and costing
src/features/wallets       card-first accountant adjustment workflow
src/features/reports       report ranges and typed report API clients
src/features/security      super-admin step-up and credential reset
src/lib/api                route wrapper, validation, and normalized errors
src/lib/auth               roles, permissions, and request authorization
src/lib/crypto             card/session fingerprinting
src/lib/supabase           browser, request-scoped, and secret clients
src/app/api                thin HTTP adapters only
supabase/bootstrap.sql     authoritative schema and atomic RPC functions
```

## Non-monolith rules

1. React components may not import the secret Supabase client.
2. Client components call feature API clients, never database tables.
3. Route handlers contain no business calculations; they parse, authorize and delegate.
4. Domain calculations are pure and tested.
5. Postgres repeats all consequential checks and owns atomic mutation.
6. No generic `updateBalance`, `updateStock`, or `updateCredential` method exists.
7. Every route declares one required permission.
8. Every immutable ledger/movement record carries staff, terminal session, reference and timestamp.

## Workspaces

- `/pos` — cashier-only catalog and checkout.
- `/inventory` — inventory administrator and super administrator.
- `/accounting` — accountant and super administrator.
- `/security` — super administrator only.

The UI guard improves usability. The API permission check and database RPC check are the security controls.

## Deferred Supabase connection

The architecture currently terminates at the Supabase client factories. Environment values are blank, no project is linked, and no schema has been applied. `supabase/schema/*.sql` and `supabase/bootstrap.sql` are local design artifacts only until an authorized person applies them manually. See `SUPABASE_CONNECTION_LATER.md`.
