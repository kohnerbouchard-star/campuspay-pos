# CampusPay pre-merge hardening — 8 September 2026

This pass continues PR #2 on `feat/campuspay-ui-ux-refresh`. It preserves the
existing payment, enrollment, inventory, and delivery workflows. Nothing in this
pass authorizes a merge, deployment, or production migration.

## Delivery record

| Requested field | Result |
| --- | --- |
| 1. Starting SHA | `2320e85a7d82943b3753e2b0396f17e38c393fca`; existing CI was green before edits. |
| 2. Ending SHA | The final handoff and PR head identify the commit; a commit cannot contain its own SHA. |
| 3. PR | [#2](https://github.com/kohnerbouchard-star/campuspay-pos/pull/2), existing feature branch, base `main`. |
| 4. Final PR head | Verified against GitHub in the final handoff, including Actions for that exact commit. |
| 5. Base SHA | `18aace8950820163974e6b1199db45bb16ae40ad`; rechecked before push. |
| 6. Dependencies | Drizzle ORM `0.44.5 → 0.45.2`; React and React DOM `19.2.4 → 19.2.8`; Playwright `1.55.0 → 1.55.1`; Vitest `4.0.6 → 4.1.11`. Next.js remains `16.3.4`. |
| 7. Dependency audit | Runtime and complete installed dependency audits report zero vulnerabilities. CI separately runs `npm run security:dependencies` alongside the existing architectural audit. No advisory exceptions. |
| 8. Authentication | Known and unknown student/staff identifiers call one shared bcrypt verifier. Its fixed dummy hash uses bcrypt cost 12, matching stored credentials. Generic responses and persistent lockouts remain. |
| 9. Staff sessions | Fifteen-minute sliding server expiry, an absolute eight-hour deadline from session creation, five-minute POS workstation lock, fifteen-minute other-workspace lock, final 30-second warning, activity heartbeat at most once per minute. |
| 10. Business dates | `private.business_timezone()` defines `Asia/Seoul`; prospective SALE, WEB, RCV, ADJ, and WAL references use its business-date helper. Reports, display timestamps, and coupon/event time inputs use Korea time. No historical identifiers change. |
| 11. Inventory locks | Online allocation explicitly orders product IDs, then existing FIFO/LIFO lot order. POS retains product ordering. Stock receipt acquires product locks in order and retains submitted-line rounding semantics. Single-product stock removal preserves its costing logic. |
| 12. Concurrency | Real overlapping reversed two-product orders verify exact stock, signed movements, wallet debits, sales/items, COGS allocations, tender rows, replay, and oversell rejection. |
| 13. Fulfillment | Active stages sort oldest first; delivered history newest first. Visible, online queues poll every 20 seconds without concurrent refresh/transition requests. Selection and the selected order’s picking checks survive refresh. |
| 14. Reports | Page/navigation accept any report permission. Each module renders and fetches only for its own permission. Inventory Admin cannot fetch sales/wallet reports; Accountant gains no inventory mutations. |
| 15. Headers | Existing private/no-store, nosniff, same-origin referrer, and frame DENY remain. Dynamic nonce CSP, Permissions-Policy, and HSTS on configured HTTPS production hosts are added. |
| 16. Proxy/IP | On Vercel (`VERCEL=1`), only the validated single address in `x-vercel-forwarded-for` selects the IP bucket. Other deployments use one unverified-ingress bucket; arbitrary forwarded headers cannot choose another bucket. |
| 17. Browser recovery storage | Version 2 retains only student UUID and idempotency UUID. Legacy proposal metadata is scrubbed for all students. Success, definitive failure, editing an unsubmitted review, and resolved sign-out clear the key. A genuinely unresolved operation retains only opaque IDs across sign-out. |
| 18. Observability | Every API handler uses a constant route template and emits request ID, timestamp, method, status, normalized code, surface, and duration. Responses carry `X-Request-ID`; pool failures emit a fixed sanitized operational event. |
| 19. Migration safety | Direct owner connection, host pin, advisory lock, per-file transaction/rollback, read-only preflight, current version/pending list, gap/unknown-version rejection, and optional runtime-role checks. Runtime test servers explicitly receive no owner URL. |
| 20. Schema drift | Exact module/migration correspondence is checked for modules 013 onward. Historical 001–012 are deliberately excluded from this exact-byte mapping. |
| 21. Unit tests | 130 tests in 19 files pass. Baseline was 114 tests; added coverage addresses authentication structure, sessions/permissions, dates, IPs, headers, storage, and log redaction. |
| 22. Integration | Full disposable PostgreSQL HTTP suite passes: 39 existing coverage groups plus 18 new hardening groups, release-preflight negative cases, and actual pre-refresh schema compatibility. See `scripts/hardening-integration.mjs` and generated results. |
| 23. Visual QA | 224 captures of 59 states at widths 1440, 1024, 768, and 390 pass with zero unexpected browser errors or layout findings. Five existing images were updated and four added. See [visual QA](visual-qa/README.md). |
| 24. Neon QA | Pinned non-primary/non-default `dev-ui-ux-refresh-20260907` (`br-late-bread-azrpu2xh`). Only new migrations 020/021 applied; all six acceptance checks pass and fixture rollback is verified. Post-migration preflight has no pending migrations and runtime grants pass. Results are recorded with visual evidence. |
| 25. GitHub Actions | The final handoff supplies the run and exact final head result. No deployment step was added. |
| 26. Limits | See the operational limits below. |
| 27. Physical card reader | Real scanner capture, PIN privacy, and register hardware acceptance remain required. |
| 28. E202 | Real enrollment, identity handover, replacement, and support procedures still require school acceptance. |
| 29. Cash/change | Event setup, physical cash counting/change, receipt reconciliation, and register operation still require school acceptance. |
| 30. Merge recommendation | Recommend code merge only after exact-head CI and the recorded review pass. Production rollout remains separately authorized and depends on operator acceptance and migration planning. |

## Security maintenance and sources

The [Drizzle advisory](https://github.com/drizzle-team/drizzle-orm/security/advisories/GHSA-gpj5-g38j-94v9)
is fixed by 0.45.2. The installed Next peer range accepts React 19.2.8; the
[React release](https://github.com/react/react/releases/tag/v19.2.8) supplies the
current compatible patch. The [Playwright installer advisory](https://github.com/advisories/GHSA-7mvr-c777-76hp)
is addressed by 1.55.1. Although CampusPay does not expose a Vitest UI server,
the [Vitest advisory](https://github.com/vitest-dev/vitest/security/advisories/GHSA-5xrq-8626-4rwp)
was addressed by updating to 4.1.11 as well.

The exact direct versions are pinned. npm encountered an internal dependency-tree
error when changing Vitest in the existing installation; a clean graph was
generated in an ignored temporary directory from those exact pins, then installed
with `npm ci`. Compatible transitive dependencies changed with that lockfile.
Both audit scopes and the full validation matrix cover the resulting installation.

CI uses `npm audit --omit=dev --audit-level=high`. It fails closed on audit-service
failure as well as high/critical runtime advisories. Any future exception must
identify the advisory, affected path, reachability evidence, owner, expiry, and
replacement plan in a reviewed change. This pass introduces no ignore list.

## Session and authentication policy

The server validates expiry using its clock after acquiring the session lock.
It rejects expired/revoked sessions, disabled users/terminals, and changed roles
before renewal. Every renewal is capped at `created_at + 8 hours`. Client activity
never revives a server session. Meaningful pointer, keyboard, and touch events
mark activity; there is no mousemove RPC. Heartbeats are deduplicated, limited to
one per minute, and require activity plus a visible online page.

All staff pages receive the shell timer. POS keeps its dedicated five-minute
timer and bounded payment/receipt protection, without a second shell heartbeat.
Other workspaces warn in the final 30 seconds of fifteen idle minutes. An expired
timer cannot be reset by a late interaction. Two-minute payment-intent deadlines
and short step-up approval deadlines are unchanged.

Both login paths invoke `private.verify_pin_proof` once after account lookup.
It computes `crypt(proof, coalesce(stored_hash, fixed_dummy_hash))` before returning
whether a real credential matched. Missing accounts cannot short-circuit the
expensive primitive. Account-locked paths remain generic and perform verification;
an already rate-limited IP can be rejected before expensive work. Structural tests
inspect both definitions and the single primitive; database tests inspect live
bcrypt costs and identical failure bodies. No nanosecond-equality claim is made.

## Date and migration compatibility

All new dated references use the school business day. Report date bounds convert
inclusive/exclusive local dates through the same database timezone helper. The
client’s matching `BUSINESS_TIMEZONE` centralizes display and date input behavior;
explicit tests cover both sides of midnight while PostgreSQL uses UTC.

The QA database has a historical wallet-confirmation result containing
`approved/error_code` fields that the original local foundation lacks. An initial
021 attempt correctly failed with SQLSTATE 42P13 and rolled back. The corrected
021 migration preserves installed wallet-confirmation and stock-removal signatures,
grants, PIN handling, and financial bodies, replacing only the single expected
date formatter. A guarded replacement fails if that formatter is not found exactly
once. A separate rollback rehearsal verified this against QA before application.
No function drop or historical journal rewrite is needed.

Migration/schema pairs are matched by their shared filename suffix for modules
013–021 (and future modules). Modules 001–009 form the original combined migration;
010–012 retain historical bootstrap/completion behavior. `schema-drift-check.mjs`
rejects missing, ambiguous, or byte-divergent later pairs in static validation.

For a separately authorized release, explicitly supply a direct owner connection
and `EXPECTED_DATABASE_HOST`, then run `scripts/migrate.mjs --preflight
--check-runtime`. Confirm its host/database, current version, and pending list.
Normal startup never migrates. `--preflight` creates no schema or migration table.
Migration errors print only a safe operational code and the migration version.

## CSP and deployment boundary

The policy follows the installed Next 16 nonce guidance. Proxy creates a fresh
nonce, places CSP on the forwarded request and response, and overwrites the nonce
and correlation request headers. The root layout waits for a request so Next
can nonce framework and inline scripts. Production scripts have neither
`unsafe-eval` nor `unsafe-inline`; development alone permits eval and injected
stylesheet elements for Next’s debugging overlay and hot reload.
Stylesheet elements use nonces. `style-src-attr 'unsafe-inline'` is the narrow
exception for React’s existing progress widths/dialog geometry. There are no
third-party script/connect origins.

HSTS is emitted only in production when the request host matches an explicitly
configured HTTPS staff/store/app origin. It does not include subdomains or preload.
HTTP localhost receives no HSTS or forced HTTPS upgrade. Permissions-Policy denies
unused camera, microphone, geolocation, payment, USB, serial, and Bluetooth APIs;
the existing reader acts as keyboard input.

[Vercel documents its forwarded headers](https://vercel.com/docs/headers/request-headers).
The app trusts `x-vercel-forwarded-for` only with Vercel’s server environment marker
and a syntactically valid single IP. It never falls back to caller-controlled
`X-Forwarded-For` or `X-Real-IP`. Self-hosting requires a separately reviewed trusted
ingress adapter; until then users share the fallback IP bucket. Account lockouts
remain independent, and spoof tests prove new header claims cannot bypass a lock.

## Recovery, logging, and operational limits

Online recovery takes only an opaque key and authenticates its student server-side.
Placement and recovery acquire the same transaction advisory lock. A committed
order returns its original receipt; a missing order records a student-scoped
closure, preventing the original delayed request from committing afterward.
Another student’s closure cannot cancel that student’s request. Recovery never
replays a saved cart or needs a delivery note/coupon in sessionStorage.

Stale legacy metadata for other students is scrubbed too. Unresolved opaque IDs
are the deliberate cleanup exception: removing them before an authoritative result
would defeat recovery. They are never shown to a different signed-in student and
cannot retrieve another student’s receipt. Sign-out tries to resolve/close its own
pending key; if offline or expired, it preserves only that opaque key for the same
student’s later sign-in. Closing/clearing the tab loses local recovery references;
authoritative order history remains the fallback.

Picking checks are local to the selected order’s mounted React view. Polling does
not reset them. Switching away, reloading, or closing the page can reset them;
they do not synchronize between fulfillment employees. Server order status and
immutable status-event history remain authoritative. A failed transition refreshes
the queue; an unsuccessful refresh disables further transitions until reconciliation.

Logs use code-owned route templates, never request URLs/query strings, raw errors,
bodies, credentials, card fingerprints, cookies, coupon codes, or delivery notes.
No authenticated PII is needed. Error responses retain their safe existing bodies
and expose correlation through `X-Request-ID`. Database pool errors emit a fixed
event without a credential-bearing exception object.

Background throttling, connectivity loss, an eight-hour deadline, or administrative
revocation can still require sign-in. IP grouping behind school NAT can temporarily
affect multiple students. Queue/history result limits and lack of historical
pagination remain. Full drawer reconciliation, refunds, multi-wallet splits,
formal accessibility certification, and physical school-device acceptance remain
outside this targeted pass.

## Final code review

The review compared each replaced settlement function with its previous definition.
POS confirmation changes only the reference-date formatter. Online placement adds
the student-scoped recovery fence, the date helper, and explicit allocation order.
Receiving adds ordered product locks and the date helper while preserving line
rounding. Wallet confirmation and single-product removal preserve their installed
bodies through the guarded formatter replacement. Wallet-floor checks, coupon
locks/redemption limits, FIFO/LIFO allocation, COGS, sale/tender reconciliation,
immutable journals, and idempotent receipt returns remain in the same transaction.

Authentication review checked real/dummy verification before account-specific
failure, generic login envelopes, lockout updates that commit on rejected login,
host-only HttpOnly/SameSite cookies, HMAC proofs, and server-authoritative expiry.
Authorization review traced report modules and the new recovery route through
server session authorization and database ownership/permission checks. The fixed
RPC registry still binds values with explicit SQL casts; no caller can choose a
function name or SQL fragment. Every API mutation, including bodyless logout and
activity, now checks the origin before invoking its handler.

Recovery review checked completed replay, unknown outcomes, late arrival after
closure, cross-student access, same-key closures belonging to different students,
reauthentication, and browser-storage minimization. Logging review checked that
only a fixed field allowlist is emitted and database error objects are discarded.
Header review checked fresh nonce forwarding, dynamic rendering, production versus
development policy, host-gated HSTS, and staff/store compatibility. Release review
checked exact schema pairs, owner/runtime separation, host pinning, transaction
rollback, the historical QA signature, and negative preflight cases. No unresolved
blocking code-review finding remains; the operational limits above still apply.
