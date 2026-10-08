# Refund readiness, drawer custody and bounded staff login

Base: integration `4e75bf8883df592fee52e9521ab18a0f0c706f5a`. This change addresses the three approved audit findings only. It does not enable features, migrate a hosted database, deploy, change credentials, or merge the production release.

## Cash refunds

Issuing a refund and recording its cash handover remain separate permissions. The payer may differ from the issuer, but must hold `refunds.cash_payout`, use the refund's original terminal, and own its open drawer or have explicit `cash.drawer.override` when cash controls are enabled. The existing payout journal and audit event record the actual payer; the original refund retains its issuer. Deferred integrity checks validate the payer against that payout's own authenticated session and preserve all financial and terminal equality checks.

The new readiness endpoint requires `refunds.read` and reports permission, terminal and drawer readiness without granting access. Full and partial refund forms check cash readiness before submitting; the handover form stays unavailable until readiness is confirmed, expires its displayed readiness after 30 seconds, and checks expiry synchronously on submission. A failed lookup blocks the action and offers a retry. Readiness is advisory: the database always rechecks before a new cash operation commits.

A trigger checks the **computed positive cash refund leg**. With cash controls enabled, issuance requires an open drawer whose owner can record payouts, or a current issuer with both payout and drawer-override capability. Thus an issue-only operator can issue for an eligible separate payer without receiving broader access. A zero cash leg, including a partial-refund rounding result, does not acquire this cash prerequisite. When drawer controls are disabled, the existing installation mode remains supported, but at least one active payout-capable operator must exist. No setting is enabled by migration.

Payout attribution checks the drawer owner/override while holding the same shift lock used by closing. Replays of a completed handover remain available after a drawer closes. The existing exact amount, request-key/payload conflict, unique refund payout, append-only journals and lost-response recovery remain in place. No amount allocation, wallet credit or stock-cost formula changes.

## Staff login

The server derives a domain-separated ingress HMAC using the existing trusted-ingress policy. Request JSON cannot choose its rate-limit bucket. Local HTTP uses the explicitly local credential bucket fallback; production uses overwritten Vercel ingress or the signed self-hosted ingress. The new five-argument login API admits at most one in-flight verification per ingress bucket and 30 attempts per minute, including unknown identities. It stores HMACs only. Owner-controlled maintenance can prune expired `private.staff_login_limits` buckets; no runtime table access is granted.

Bcrypt runs against a snapshot **without holding staff, credential, session, terminal or administration locks**. Known and unknown admitted identities use the existing real/dummy verifier; locked accounts also complete the verifier before returning a generic failure. Failed-attempt updates use a nonblocking credential lock and only apply to the credential hash actually checked.

Successful verification is not authorization to create a session. Finalization uses the existing lifecycle lock namespace via `pg_try_advisory_xact_lock`, drains terminal sessions with `NOWAIT`, locks the credential and terminal with `NOWAIT`, rechecks the hash/lockout, active profile and terminal, and reads current role/access revision before session creation. Busy state returns the same empty authentication result as invalid credentials, with no partial session revocation. This avoids queueing behind the global administration lock and preserves concurrent reset/deactivation/access-change protections. It is not a guarantee against every distributed denial-of-service attack.

Runtime execution of the old four-argument login API is revoked; its historical definition remains owner-only for upgrade rehearsals. New application servers fail closed on a database lacking the five-argument API. Existing valid sessions are not revoked by the migration. A deployment owner must coordinate the application/database cutover; this PR performs neither.

## Migration ownership and sequencing

Additive pair: `database/schema/052_refund_login_hardening.sql` and `database/migrations/20261008070000_refund_login_hardening.sql`. Historical050 and all earlier SQL files are unchanged.

PR50 reserves schema051 for product photos. [Coordination](https://github.com/kohnerbouchard-star/campuspay-pos/pull/50#issuecomment-6050323678) requests a photo migration timestamp **after 20261008070000**, allowing these urgent fixes to ship independently after050 without a later migration-history gap. Numeric schema labels do not determine migration order. Confirm the eventual photo timestamp before either release; this PR has no dependency on photo SQL. The new branch is deployment-held in `vercel.json`.

## Verification

`scripts/verify-audit-fixes.mjs` creates disposable localhost-only databases and synthetic identities. It covers:

- Forward upgrade and transaction rollback; historical financial journals, credentials, sessions and flags stay byte-equivalent as JSON snapshots.
- Full and partial refunds with separate issuer/payer identities, missing capability, wrong terminal, foreign drawer, explicit override, exact amounts, parallel replay, changed payload, closed drawer, missing payer and full transactional rollback.
- A controlled native close/payout overlap, restricted runtime grants and old-login denial.
- Real browser closed/unavailable readiness, refresh, mobile rendering and committed-but-lost payout recovery with exactly one payout request/event.
- Valid/invalid/locked/unknown login, ingress budget/exhaustion/reset and nonblocking ingress/global/session locks.
- Controlled bcrypt barriers while real administration APIs deactivate staff, reset PINs, disable terminals and change role/access. Stale snapshots cannot create sessions; access changes produce only current authority.
- Identical HTTP invalid-credential response bodies for known and unknown identities.

The old administration suite's blocking-login cases are replaced by the new nonblocking login cases. Its administration-vs-operation deadlock negative control and remaining concurrency/editor checks are retained. Disabled-terminal login now returns generic HTTP401; the administration acceptance test checks that it matches unknown-login failure, creates no active terminal session and leaves session access denied. The stock050 upgrade rehearsal is explicitly bounded at050 so later independent migrations do not invalidate its historical scope.

Preliminary local results: 21 focused native/browser checks; 12 existing full-refund acceptance groups; six partial-refund groups plus three controlled overlaps; ten administration lock cases plus four editor checks; seven effective-access groups. Typecheck, lint, static validation and build pass (lint retains two pre-existing unused-variable warnings). Browser screenshots and JSON evidence are emitted into `.validation/audit-fixes/`.

**Qualification limits:** local `npm ci` encountered registry tarball integrity failures and was stopped without changing the lockfile. Preliminary tests used the existing environment dependency tree (including Next16.3.4); exact-lockfile CI uses Node22 and `npm ci` and is authoritative for release qualification. No integrity check was disabled. The local complete dependency policy rejected audit metadata drift for the five development-only braces-chain findings; this did not reproduce in exact-lockfile CI at9cb3e6e, where both unchanged dependency gates passed. The separate runtime audit reports zero advisories. The development-only exception still expires November1,2026 and was not broadened. The new CI workflow preserves both gates and uploads their evidence. A red gate must remain visible, not be interpreted as approval to reopen.
