# Supabase connection — intentionally deferred

## Current state

This source package is **not connected to a Supabase project**. No project was created, linked, queried, migrated, or modified while preparing the package.

The code contains only the connection boundaries needed later:

- `src/lib/supabase/browser.ts` — browser client factory using the publishable key.
- `src/lib/supabase/server.ts` — request-scoped server client using the signed-in user's session.
- `src/lib/supabase/admin.ts` — server-only privileged client using the secret key.
- `src/lib/supabase/rpc.ts` — the single application wrapper for typed PostgreSQL RPC calls.
- `.env.example` — blank connection and security-secret placeholders.
- `supabase/schema/*.sql` — local, inert schema modules.
- `supabase/bootstrap.sql` — a generated local SQL bundle; it does nothing until a human applies it.

## What has deliberately not been done

- No Supabase organization or project creation.
- No `supabase link`.
- No migration push.
- No SQL execution against a hosted database.
- No Data API schema exposure.
- No Auth user creation.
- No API keys stored in the repository.
- No remote type generation.

## Values to enter later

Copy `.env.example` to `.env.local` and supply:

```text
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
SUPABASE_SECRET_KEY
CARD_HMAC_SECRET
COUPON_HMAC_SECRET
STUDENT_PIN_PEPPER
SESSION_HMAC_SECRET
TERMINAL_COOKIE_SECRET
```

The publishable key may be used by browser code subject to correct database policies. The secret key and every HMAC/PIN/cookie secret must remain server-only.

## Offline configuration check

After entering values, this command checks only that the required environment variables are present:

```bash
npm run connection:check
```

It does not contact Supabase and does not prove that the values are valid.

## Connecting later

Only when the deployment decision has been made:

1. Create the development Supabase project.
2. Enter the project URL and keys in `.env.local` or the deployment secret manager.
3. Review every SQL module under `supabase/schema/`.
4. Apply the schema manually in the development project.
5. Expose only the required API schema and preserve RLS/grants.
6. Create individual staff Auth identities.
7. Generate project-specific database types.
8. Run integration tests against the development project before production.

There is intentionally no automated `db push`, project-link, or hosted migration command in the standard validation workflow.
