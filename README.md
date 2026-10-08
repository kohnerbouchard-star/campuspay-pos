# CampusPay schema 39–40 operator package (Windows Git Bash + Docker Desktop)

**Qualified source:** `kohnerbouchard-star/campuspay-pos` commit `d01d2992659dbab3d6aff95581dd6bed5f618daf`, tree `4c5583b65e2963ff71f6cd4f8212b10832e50e65`. This package contains no database credentials, backup key, SQL copy, Blob configuration, or deployment action. It invokes the repository's migration and encrypted backup scripts. Keep maintenance enabled and product photos disabled. Never rerun stock migration 050.

## Prepare your Windows computer

Use **Docker Desktop in Linux containers mode**, Git for Windows Git Bash with `winpty`, and enough free disk space for a database backup and disposable restore. No WSL installation is required. You need the existing `campuspay_owner` password and the **existing** base64 backup encryption key; keep both out of chat, command arguments, screenshots, and logs. Docker stores an ephemeral copy of the source and encrypted backup in local Docker volumes. The disposable PostgreSQL has no host port.

Download and extract this ZIP to `~/Downloads/campuspay-release-d01-operator`. In Git Bash, create a fresh source checkout with byte-identical SQL files:

```bash
git clone --no-checkout https://github.com/kohnerbouchard-star/campuspay-pos.git "$HOME/campuspay-release-d01-source"
git -C "$HOME/campuspay-release-d01-source" config core.autocrlf false
git -C "$HOME/campuspay-release-d01-source" checkout --detach d01d2992659dbab3d6aff95581dd6bed5f618daf
```

Pull the two pinned tool images, then run setup. `setup` checks the Git head, tree, and clean state, builds an offline tool image, copies the source into a private volume, installs locked dependencies, and checks all 40 migrations and key scripts byte for byte.

```bash
docker pull node@sha256:43ac6c60b8f89723f746e8a92ce91abd5017e627ce1ddfe4238355d3a30b772c
docker pull postgres@sha256:639ab7ceb90e13123085b741fb31ef493fba25463002f6da665352e7b534b652
bash "$HOME/Downloads/campuspay-release-d01-operator/run-docker.sh" setup "$HOME/campuspay-release-d01-source"
```

If the ZIP extracts into an extra folder, use that folder's actual `run-docker.sh` path. Run each next command separately. The owner password and backup key are entered through hidden terminal prompts. The production connection is pinned to the direct `campuspay` database as `campuspay_owner` with verified TLS.

## Cutover steps

**1. Read-only preflight.** Require `SCHEMA_38_PREFLIGHT_ONLY`, exactly 38 history rows, last `20261007120000_stock_adjustment_recovery`, and only `20261008070000_refund_login_hardening` then `20261008090000_product_photos` pending. Stop on any difference.

```bash
bash "$HOME/Downloads/campuspay-release-d01-operator/run-docker.sh" preflight "$HOME/campuspay-release-d01-source"
```

**2. Fresh encrypted backup and disposable restore.** This makes a new encrypted `.cpbackup` and restores it into the local, disposable PostgreSQL. Require `BACKUP_AND_LOCAL_RESTORE_VERIFIED`.

```bash
bash "$HOME/Downloads/campuspay-release-d01-operator/run-docker.sh" backup-and-restore "$HOME/campuspay-release-d01-source"
```

**3. Export and retain the encrypted backup.** Create an empty secure folder on your computer and export the ciphertext. The command checks its SHA-256 after copying. Retain both this file and the existing encryption key through cutover.

```bash
mkdir -p "$HOME/campuspay-secure-backup"
bash "$HOME/Downloads/campuspay-release-d01-operator/run-docker.sh" export-backup "$HOME/campuspay-secure-backup"
```

Do not continue if any step failed or maintenance is no longer enabled. Share only sanitized status lines and encrypted backup SHA-256 for review; never share passwords, keys, URLs containing passwords, or database contents.

**4. Apply only migrations 39 and 40.** The wrapper requires the verified, exported backup and a typed `APPLY-39-40` confirmation. The driver rechecks schema 38 and unchanged data before writing a durable attempt marker. The repository migration runner holds advisory lock `84632291` and applies each migration in its own transaction. Require `SCHEMA_40_VERIFIED_APP_RELEASE_PENDING` and `PRE_EXISTING_TABLES_UNCHANGED`.

```bash
bash "$HOME/Downloads/campuspay-release-d01-operator/run-docker.sh" apply "$HOME/campuspay-release-d01-source"
```

**Never repeat `apply` if the attempt starts and the result is missing or uncertain.** Run the read-only postflight, inspect exact history, and arrange a reviewed fix-forward procedure.

```bash
bash "$HOME/Downloads/campuspay-release-d01-operator/run-docker.sh" postflight "$HOME/campuspay-release-d01-source"
```

The local PostgreSQL can be stopped after the final result. The evidence Docker volume remains for audit; do not remove it during cutover.

```bash
bash "$HOME/Downloads/campuspay-release-d01-operator/run-docker.sh" stop-local
```

## App release boundary

After schema 40 proof, the release owner merges the **same qualified source** into `main`, validates the actual merge commit, deploys that exact commit to Vercel project `prj_wXkpTGGYjL6emMhAX6RSwxkafkME` under team `team_PRsNkw4DHrGsUHl6ikKw2XyJ`, and verifies both MICA domains and runtime. Keep maintenance enabled and `PRODUCT_PHOTOS_ENABLED` disabled. Blob provisioning, public image settings, credential changes, data cleanup, maintenance reopening, and older-app rollback are outside this package.
