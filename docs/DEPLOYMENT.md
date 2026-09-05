# Deployment

1. Apply `database/migrations/20260904190000_initial_campuspay_neon.sql` using the Neon owner/direct connection.
2. Create a limited LOGIN role with no `BYPASSRLS`, `CREATEDB`, or `CREATEROLE`, and grant it only `campuspay_runtime`.
3. Set the application's pooled connection string as `DATABASE_URL`.
4. Set unique 32-byte values for every application secret.
5. Bootstrap the first super administrator outside source control.
6. Run `npm run db:health`, all validation commands, and role-permission tests.
7. Use `COOKIE_SECURE=true` behind HTTPS.

Do not deploy with the Neon owner role. Do not expose a database connection string through any `NEXT_PUBLIC_` variable.
