# CampusPay hardening and recovery — 1 October 2026

## Scope and evidence

This change follows main c3b58d7dabe665007b4e7be81c73c9622ac331eb (Next.js 16.3.8).
It changes application boundaries, recovery tooling and CI, not financial journals,
student issuance, operational feature gates, hosting, school domains or billing.
The 31 historical migrations remain unchanged.

## Public deployment is fail closed

A public production process requires distinct HTTPS STAFF_ORIGIN and STORE_ORIGIN
hostnames, COOKIE_SECURE=true (or its secure default), and no DATABASE_URL_UNPOOLED
in the application process. APP_ORIGIN is never a fallback public hostname.
Unconfigured production returns 503; unapproved hosts return 403. Mutating APIs
require the exact same-surface Origin and reject cross-site or sibling-origin calls.
Different ports on one hostname do not provide cookie isolation and are rejected.
Vercel uses its platform-overwritten client-IP header. Public self-hosting additionally
requires CAMPUSPAY_INGRESS_SECRET (at least 32 characters) and a signing ingress.
These deployment settings do not establish school acceptance or permit demo access.

Local development (`npm run dev`) remains available on loopback. For a production
build tested locally, explicitly set CAMPUSPAY_LOCAL_HTTP=true, APP_ORIGIN to the
exact loopback origin, leave STAFF_ORIGIN/STORE_ORIGIN empty, and bind `next start`
to 127.0.0.1. This override is rejected on Vercel. It is not a LAN/public deployment.
Disposable integration runners inherit the override in CI; test:integration:isolated
sets it itself. Never set it for a public server.

## Self-hosted signing ingress

Keep the backend inaccessible except through the trusted ingress. Overwrite, rather
than append or preserve, all client-supplied x-campuspay-* and forwarded-IP headers.
Use the actual peer IP established by that ingress, not a caller-provided X-Forwarded-For.
For each request, produce these headers:

- x-campuspay-client-ip: one validated IPv4/IPv6 literal, without a port or list.
- x-campuspay-ingress-time: Unix timestamp in whole seconds, exactly ten digits.
- x-campuspay-ingress-signature: lowercase hex HMAC-SHA256 using the ingress secret.

The signed message is `timestamp + "\n" + method + "\n" + pathname + "\n" + ip`.
Both machines must have synchronized clocks. Signatures expire after 30 seconds and
are bound to the method/path/IP. The signing secret must never reach a browser.
Public student sign-in fails safely if neither Vercel nor the signing ingress proves
an IP. Untrusted forwarded headers never select rate-limit buckets. Loopback-only
operation uses a credential-specific HMAC bucket, so one student does not lock all
other students. Persistent credential lockouts are unchanged. Shared school NAT
rate-limit behavior still requires a real-network acceptance test.

## Encrypted database backup and restore verification

Requires Node 22, installed project dependencies, PostgreSQL 17 pg_dump/pg_restore,
and a separately controlled backup connection. Do not put owner credentials in the
application environment or run backups from a browser/API route.

Supply BACKUP_DATABASE_URL, BACKUP_EXPECTED_HOST, and CAMPUSPAY_BACKUP_KEY through
a restricted operator environment. The key must be exactly 32 random bytes encoded
as standard base64; generate it once in an approved secret manager, keep it separate
from backups, and retain it while any associated backup is retained. Remote backup
connections require sslmode=verify-full. Use a directory outside the repository.

    node scripts/backup-database.mjs backup /secure/backups/campuspay-<timestamp>.cpbackup

The tool uses a read-only repeatable-read transaction and an exported PostgreSQL
snapshot. The dump and complete application-table digest manifest use that same
snapshot. AES-256-GCM authenticates/encrypts the manifest and binary dump; new files
are mode 0600 and existing files are never overwritten. Application schemas, pgcrypto
and recorded ACLs are included. Passwords/role-login secrets are not backed up;
production secrets need their own controlled recovery. The current in-memory archive
limit is 64 MiB: exceeding it fails, never silently truncates. Migrate to a reviewed
streaming implementation before crossing this limit.

Set RESTORE_TEST_DATABASE_URL to a disposable localhost PostgreSQL administrator
connection, then run:

    node scripts/backup-database.mjs verify-restore /secure/backups/campuspay-<timestamp>.cpbackup

Authentication is checked before any restored SQL is executed. A remote restore URL
is rejected. The tool creates its own uniquely named local database, restores recorded
ACLs, compares every application-table row count and digest, checks runtime table
isolation, then removes only its own temporary DB/roles. It never overwrites Neon main.
The CI rehearsal uses synthetic data and discards its encrypted archive/key. Its
success is tooling evidence, NOT a claim that a live backup has been retained or a
live restore accepted. Never restore across settled transactions as a code rollback.

## CI and release controls

All three GitHub Actions are pinned to their verified official full commit IDs.
A guard rejects future mutable action references. Dependabot checks Action/npm
updates weekly; Next.js dependencies are grouped. The existing complete validation
workflow also runs weekly and can be invoked manually. Native deployment-policy
coverage is enforced (95% lines, 100% functions, 85% branches); this is coverage of
that critical boundary, not a claimed whole-application or financial coverage score.
Encryption tampering/wrong-key/truncation checks and a PostgreSQL dump/restore drill
join the unchanged application, SQL, integration and browser suites.

## External release gates still required

The connected Neon account rejected main-branch protection with HTTP 422 (plan limit).
Current main is a child branch; its earlier snapshot creation was rejected as non-root.
No plan upgrade, retention increase, destructive branch conversion or network lockout
is authorized by this source change. A retained recovery branch is not an independent
scheduled backup. Configure retained encrypted backups in an approved private store
(or an approved Neon plan/root-branch arrangement) and prove an actual live restore.

Four remaining active staff accounts are named Local Test accounts, including the
only active administrator. Do not disable the last administrator blindly: provision
and verify the approved real owner account first. Numerical wallet reconciliation
alone does not approve demo data, source records or opening balances. Do not issue
student cards/PINs, invent live account credentials or silently enable financial gates.

No school-approved public domain pair, running Mac update, monitoring/alert delivery,
reader/PIN/cash-handling acceptance or supervised pilot is certified by this PR.
These gates remain on the production tracker; code merge is not public launch approval.
