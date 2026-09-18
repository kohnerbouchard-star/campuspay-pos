# CampusPay local recovery — 18 September 2026

This is a repair for the existing `~/campuspay-pos` installation, not a new database installer. It replaces the unsafe September 7 practice of copying a bundled `.env.local` over the existing configuration on every run. There are no credentials in the repair package.

## Run

With the repair ZIP extracted into Downloads:

```bash
bash "$HOME/Downloads/CampusPay_Repair_2026-09-18/Repair-CampusPay.command"
```

Once this change is merged, the same command can run from the repository:

```bash
node scripts/repair-local.mjs
```

Optional flags: `--repo /path/to/campuspay-pos`, `--check-only` (no network, dependencies, server, or file changes), and `--no-start` (repair, update dependencies, check the runtime; do not start the server). Dry-run exits 0 when already configured, 2 when a repair is needed, and 1 when unsafe or invalid.

Use Node.js 22.9 or newer. The application uses `--env-file-if-exists`, introduced in Node 22.9, so the previous generic 22+ instruction was insufficient for early Node 22 installations.

## Safeguards

The command requires the expected GitHub origin, a clean main checkout, an ignored/untracked regular `.env.local`, and the September 10 baseline in origin/main. It uses a fast-forward only; it does not switch branches, discard edits, or force-push. Local commits ahead of origin/main stop the operation.

Only the verified legacy/main Neon endpoints, database `campuspay`, and `campuspay_runtime_login` are accepted. Unknown QA/other-school endpoints are not retargeted. The runtime password and six application HMAC/pepper secrets are preserved. The repair retains the direct/pooled connection choice, applies `sslmode=verify-full`, removes conflicting SSL overrides, and pins the expected host/database. The pin must be deliberately updated after any later database cutover; branch names are not connection targets.

Before modification it checks shell and `.env.development.local` overrides. It creates a unique, Git-ignored, mode-0600 backup beside `.env.local`, writes through a temporary mode-0600 file, then atomically renames it. It rechecks the original configuration after fetching code. The current file is mode 0600 even on a repeat run. Peppers must not be regenerated on an existing installation: that can invalidate cards and PIN proofs.

The checker verifies the restricted role and 15 required API signatures/execution grants in a read-only transaction, using relation OIDs from system catalogs rather than resolving a private table through a restricted schema. It never directly selects wallet, student, credential, or order rows. Raw connection exceptions are not logged; only fixed messages and allowlisted error codes are printed. This proves capabilities and permissions, not exact migration history, actual credentials on another machine, or transaction correctness.

No migration, bootstrap, demo transaction, role grant, password reset, or database balance change is run. If dependencies, authentication, or startup fail, the configuration backup remains. The script does not automatically restore the obsolete endpoint.

## Failure handling

- `ENV_OVERRIDE`: unset the conflicting exported variable or remove the conflicting development-file definition. Do not paste secrets into chat.
- `TARGET_UNRECOGNIZED`: stop and verify the intended database branch. Do not edit the accepted list merely to bypass the check.
- `SCHEMA_CAPABILITIES`: the target lacks a required function or permission; correct the target or use a separately approved release migration. Do not migrate the legacy branch as a shortcut.
- `CONNECTION_FAILED [28P01]`: the preserved runtime password was not accepted; obtain the current restricted-runtime connection through the owner's secure channel. Never substitute an owner connection.
- `REPO_UNSAFE`: preserve local edits/commits and resolve the checkout state. The repair intentionally will not discard them.

A new workstation needs a private GitHub clone and a separately delivered, current configuration. Do not reuse the old secret-bearing installer. A versioned, secret-free first-run enrollment workflow remains a release-plan item.

## Validation scope

`node scripts/verify-local-repair.mjs` runs dependency-free configuration, redaction, metadata-check, and real-local-Git dry-run regressions. PostgreSQL behavior is additionally tested in CI through `node scripts/verify-runtime-readiness.mjs` against the disposable local database: restricted role passes, privileged owner fails. The normal existing build, unit, static, dependency, and integration checks remain enabled.

The Mac's installed password, hardware reader, and browser have not been remotely tested. Successful tool-side metadata reads do not prove Mac-side network connectivity or runtime authentication.

Reference: https://nodejs.org/download/release/v22.16.0/docs/api/cli.html#--env-file-if-existsconfig
