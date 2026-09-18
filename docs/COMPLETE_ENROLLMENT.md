# Complete enrollment for an existing roster student

This implements the development scope of issue #7. It does not authorize or automatically issue cards to the real roster. Production issuance defaults to disabled. No demo deletion, credential rotation, owner provisioning, balance adjustment, or roster import is part of this change.

## Operator workflow

Super Admin opens Students, searches by name/ID, filters Year when needed, selects the existing account and follows Complete enrollment. The dedicated screen shows name, Year, permanent ID and academic year. Confirm identity in person, scan an unused physical card, and have the student enter and confirm their PIN privately. The explicit final confirmation submits one request. Hand over the card only after a confirmed completion receipt.

The operation preserves the student UUID/code, name, Year, academic year, wallet row, balance and ledger history. It creates card/PIN credentials and an immutable enrollment/audit receipt in one database transaction. Any previous card, PIN or enrollment history makes this initial-issuance path ineligible; use replacement/reset procedures instead. Do not create a duplicate student to bypass an existing account.

## Deployment and activation boundary

Apply additive migration `20260918130000_complete_roster_enrollment` only through the established reviewed migration/preflight procedure. Source module 023 is byte-identical. The migration creates a narrow completion RPC, a recovery RPC and a protected closure table. It contains no real names or PINs and creates no student credentials on application.

New issuance requires server environment `ROSTER_ISSUANCE_ENABLED=true`; every other value, including an unset value, disables it. Keep it unset/false for the current real roster until the owner authorizes physical issuance and demo account cleanup is resolved. Recovery stays available to the original authorized operator even if new issuance is switched off during an incident. The application runtime still receives only its restricted connection; never add owner credentials to the application environment.

## Recovery and concurrency

The browser persists only the student UUID in a storage key and one request UUID as its value. It never persists names, Year, card inputs, PINs, HMAC proofs or request bodies. Credential fields are cleared immediately on submission. Failed transport or malformed/unconfirmed responses retain the opaque reference and block a fresh submission. Reloading the same student's page restores Recover result, including when the account has become issued in the meantime.

Recovery authenticates the actor, acquires the same transaction-scoped key lock as completion, and returns the original committed receipt or permanently closes a missing request. A late original request cannot issue credentials after closure. Different staff sessions for the same operator may recover; another operator or student cannot retrieve the receipt or close that reference. Different request keys for one student serialize on the existing student row. Global card uniqueness plus subtransaction rollback prevents a losing card race from leaving a PIN behind.

A completed receipt proves the initial issuance occurred; it is not a promise that later authorized card replacement, PIN reset or account deactivation has not occurred. View current account status before use. Closing a tab or clearing browser storage can lose the local reference; the directory and immutable enrollment receipt remain authoritative. Never hand over an unconfirmed card or create another student account to resolve uncertainty.

## Verification

The CI workflow runs the existing suites plus domain/storage regressions and `scripts/verify-complete-enrollment.mjs`. The latter refuses non-local hosts, creates its own uniquely named temporary PostgreSQL database and restricted runtime login, runs migrations, starts the built application and exercises actual HTTP/RPC paths. It drops only that temporary database/role during cleanup. No live database or student is used.

Acceptance coverage: disabled issuance; anonymous/non-admin/wrong-origin/input denials; stale name/Year/academic-year rejection; inactive and already-issued accounts; repeated names in distinct Years; one atomic card/PIN/receipt; identical retries; cross-operator/student recovery rejection; recovery closure fencing; competing student/card requests; forced audit failure rollback; pre-existing wallet preservation; subsequent student login and POS use; private-table denial; recovery while issuance is disabled. The browser path tests identity acknowledgment, scanner capture, PIN confirmation/privacy, responsive layouts, committed-but-lost response recovery after reload, unchanged sibling account and credential-free storage. Synthetic pre-funded fixtures are test setup only, not production opening-balance evidence.

Exact commit, CI result, production rollout status and unchanged real-roster verification belong in the PR handoff. Passing local/CI tests does not certify school reader hardware, school-network performance, demo cleanup, or live rollout.

## Next development stage

After this prerequisite, continue append-only full-sale refunds and pre-dispatch cancellation from `docs/V1_LAUNCH_PLAN.md`: original-tender allocation, explicit restock/disposal, original cost reversal, coupon policy, idempotency, permissions and daily reconciliation. Demo cleanup (#5), financial reversals, drawer close, production hosting/recovery and physical pilot acceptance remain open release gates.
