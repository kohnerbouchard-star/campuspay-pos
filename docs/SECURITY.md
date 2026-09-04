# Security model

## Roles and minimum permissions

| Role | Permitted operations |
|---|---|
| Cashier | Read sellable catalog; create/scan/confirm POS payment intents |
| Inventory administrator | Products, prices, receipts, negative stock adjustments, inventory reports |
| Accountant | Student-wallet lookup, controlled wallet adjustments, debt and finance reports |
| Super administrator | Staff administration and one-use credential-reset authorization; inherits operational permissions only when explicitly assigned |

## Staff authentication

The sign-in form accepts an employee code and PIN. The server converts the employee code to an internal Supabase Auth email and performs password authentication. The PIN is never stored in application tables or logs. Staff PINs should be at least six digits and rate-limited.

Supabase Auth identifies the staff member. `public.staff_profiles` supplies the current active role; authorization does not trust user-editable metadata.

## Student PINs

The Next.js server first converts the PIN to an HMAC proof using a server-only pepper. Postgres verifies a salted `pgcrypto` hash of that proof. The hash is in `private.student_credentials`, which has no direct Data API policy. PIN attempts are rate-limited and the credential is temporarily locked after repeated failures. Raw PIN text is never sent to Supabase, returned, selected in reports, or written to audit payloads.

## Card identifiers

Raw card UID data exists only long enough for a server route to calculate:

```text
HMAC-SHA-256(CARD_HMAC_SECRET, normalized_card_uid)
```

Only the fingerprint is sent to or stored in Supabase. No screen or report returns a full or partial UID.

## Staff/terminal session

Authentication alone is insufficient on a shared register. A second opaque staff-session cookie is bound to a server-signed terminal cookie. Each API call verifies:

- Supabase identity;
- active staff profile;
- active terminal;
- opaque session fingerprint;
- matching identity and terminal;
- inactivity expiration;
- required permission.

Cashier sessions expire after 20 seconds without a recognized action. The frontend clears local state and returns home, while the server independently rejects stale requests.

## Super-admin step-up

Credential resets require a purpose-bound, target-bound, one-use authorization. It expires after 60 seconds and cannot be replayed for a different student or reset type.

## Supabase controls

- Sensitive tables are in `private` and receive no client grants.
- Exposed `public` tables have RLS enabled.
- The `api` schema contains narrow RPC functions.
- Every privileged RPC checks `auth.uid()`, staff status, session ownership, and permission.
- Function execution is revoked from `PUBLIC` and `anon`, then granted explicitly to `authenticated`.
- Functions set an empty search path and fully qualify object names.
- The server secret key is never included in browser code.
