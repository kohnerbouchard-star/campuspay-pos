# CampusPay schema 39–40 operator package

**Prepared source:** `kohnerbouchard-star/campuspay-pos` commit `d01d2992659dbab3d6aff95581dd6bed5f618daf`, tree `4c5583b65e2963ff71f6cd4f8212b10832e50e65`. This package contains no database credentials, backup key, SQL copy, Blob configuration or deployment action. It uses the repository's original migration and encrypted-backup scripts. Keep maintenance enabled and photos disabled. Never rerun applied stock migration 050.

## Before touching production

Use a **new isolated checkout** and a new empty evidence directory on a Linux filesystem. On a Windows computer, use WSL's native Linux home directory, **not** native PowerShell or a mounted `C:` drive: the repository backup helper requires file and directory `fsync`, which has not been qualified on native Windows. Clone without checking files out until `core.autocrlf` is false so counted SQL text stays byte-identical:

```bash
git clone --no-checkout https://github.com/kohnerbouchard-star/campuspay-pos.git "$HOME/campuspay-release-d01-source"
git -C "$HOME/campuspay-release-d01-source" config core.autocrlf false
git -C "$HOME/campuspay-release-d01-source" checkout --detach d01d2992659dbab3d6aff95581dd6bed5f618daf
mkdir -m 700 "$HOME/campuspay-release-d01-evidence"
```

Install Node 22, `pg_dump`, `pg_restore`, and an isolated **localhost-only disposable PostgreSQL** for restore verification. In the source checkout, run `npm ci`; never disable package integrity checks or edit the lockfile. Verify the checkout before supplying any secret:

```bash
node "$HOME/campuspay-release-d01-operator/verify-source.mjs" "$HOME/campuspay-release-d01-source"
```

Extract this package ZIP to `$HOME/campuspay-release-d01-operator`. Do not use an old source checkout or a later branch head. The verifier checks all 40 migration files and key operator scripts byte for byte.

## Four separate operator steps

Run each command in a fresh interactive terminal. The driver prompts without echo for the existing `campuspay_owner` password. It builds only the pinned direct `campuspay` URL with `sslmode=verify-full`; it does not send owner credentials to Vercel. Do not paste secrets into chat, command arguments, screenshots or logs.

```bash
node "$HOME/campuspay-release-d01-operator/run-release.mjs" preflight "$HOME/campuspay-release-d01-source" "$HOME/campuspay-release-d01-evidence"
```

Require `SCHEMA_38_PREFLIGHT_ONLY`: exactly 38 history rows, last `20261007120000_stock_adjustment_recovery`, and only `20261008070000_refund_login_hardening` then `20261008090000_product_photos` pending. Otherwise stop.

```bash
node "$HOME/campuspay-release-d01-operator/run-release.mjs" backup-and-restore "$HOME/campuspay-release-d01-source" "$HOME/campuspay-release-d01-evidence"
```

This prompts separately for the **existing** backup encryption key and a disposable localhost PostgreSQL restore URL, writes a new encrypted `.cpbackup`, and invokes the repository's strict restore/integrity check. It writes `backup-restore-verified.json` only after both succeed. Retain the encrypted file and key through the cutover. The old no-new-backup waiver was specific to migration 050.

Only after inspecting those results and confirming maintenance is still active:

```bash
node "$HOME/campuspay-release-d01-operator/run-release.mjs" apply "$HOME/campuspay-release-d01-source" "$HOME/campuspay-release-d01-evidence"
```

The driver requires the exact backup hash and schema-38 preflight, then durably records `migration-attempt-started.json` **before** using `scripts/migrate.mjs`. The original runner holds advisory lock `84632291` and applies each pending migration in its own transaction. It must report both exact `Applied ...` lines and pass the read-only schema-40 grant/history probe. Keep maintenance active. **If any result is missing or uncertain, do not invoke `apply` again.** Use the read-only `postflight` mode, inspect history, and arrange a reviewed fix-forward procedure.

```bash
node "$HOME/campuspay-release-d01-operator/run-release.mjs" postflight "$HOME/campuspay-release-d01-source" "$HOME/campuspay-release-d01-evidence"
```

The successful terminal result is `SCHEMA_40_VERIFIED_APP_RELEASE_PENDING`. Report only sanitized status lines and SHA-256 of the encrypted backup, not credentials or database contents.

## App release boundary

After schema 40 is verified, the release owner must merge the **same qualified source** into `main`, validate the actual main merge commit, deploy that exact commit to project `prj_wXkpTGGYjL6emMhAX6RSwxkafkME` under team `team_PRsNkw4DHrGsUHl6ikKw2XyJ`, and verify both MICA domains and runtime. `PRODUCT_PHOTOS_ENABLED` remains disabled. No Blob store, public-image setting, photo credential, data cleanup, maintenance reopening or older-app rollback is included. On failure, keep maintenance closed and fix forward.
