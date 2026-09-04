# Validation report

Generated: September 4, 2026

## Completed local-only checks

The following checks passed without a Supabase connection:

- TypeScript/TSX syntax transpilation for 110 source files.
- Local `@/` and relative import-resolution audit for 110 source files.
- Coupon policy runtime checks for fixed, percentage, capped, minimum-spend, and fully discounted orders.
- Ordered SQL-module structure audit.
- Coupon-table, fingerprint, redemption-ledger, limit, locking, grant, and zero-total transaction checks.
- Static secret-boundary, client/server import, least-privilege endpoint, credential-leak, RLS, private-schema, search-path, idempotency, and row-lock audit.
- Bootstrap reconstruction from eight ordered SQL modules.
- Offline connection-state check confirming the Supabase values are intentionally absent.

The command used for the local static suite is:

```bash
npm run validate:static
```

The configuration check is:

```bash
npm run connection:check
```

It currently exits with `UNCONFIGURED`, as intended, and makes no network request.

## Not performed

Full dependency-based checks were not completed in this environment because the pinned npm dependencies were unavailable in the local cache and the external installation attempt timed out. Therefore, these still need to be run after dependency installation:

```bash
npm install
npm run typecheck
npm run test
npm run lint
npm run build
```

No Supabase integration test was run because the user explicitly deferred the connection. No schema was applied, no project was linked, and no remote database advisor was called.

## Required later verification

After connecting a development project, verify:

- SQL migration execution and rollback behavior.
- RLS and grants using each employee role.
- Coupon quote versus final student-specific eligibility.
- Simultaneous redemption at global and per-student limits.
- Simultaneous last-unit inventory purchases.
- Idempotent retries and duplicate RFID reads.
- Wallet floor enforcement at −₩15,000.
- Zero-total coupon transactions.
- Twenty-second cashier session expiration.
- Actual card-reader behavior and network interruption.
