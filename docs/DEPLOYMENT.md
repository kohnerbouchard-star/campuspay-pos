# Deployment checklist — deferred

No hosted deployment or Supabase setup has been performed for this package.

## Before connecting anything

1. Approve the school privacy, retention, debt, refund, and coupon policies.
2. Decide who owns the cashier, inventory administrator, accountant, and super-administrator roles.
3. Review the SQL under `supabase/schema/` and the API contract under `docs/API.md`.
4. Generate unique server-side HMAC, PIN-pepper, session, and cookie secrets.
5. Confirm the physical reader's card format and keyboard/HID behavior.

## When you choose to connect Supabase later

1. Use a separate development project first.
2. Enter the project's URL, publishable key, and secret key through environment variables; never commit them.
3. Apply the schema manually after review. The repository does not push it automatically.
4. Expose only the required Data API schema; never expose the private schema.
5. Preserve RLS and explicit grants on every exposed object.
6. Create one Auth identity per employee; never share cashier accounts.
7. Generate database types only after the project is linked intentionally.
8. Test employee authorization, reader focus, duplicate scans, wrong PIN, coupon limits, wallet floor, sold-out races, refunds, and network interruption.
9. Run framework validation and database security/performance advisors.
10. Configure HTTPS, secure cookies, backups, restoration tests, wired networking where possible, and UPS coverage.

See `SUPABASE_CONNECTION_LATER.md` for the exact connection boundary.
