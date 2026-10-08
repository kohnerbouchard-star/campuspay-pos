# CampusPay product photos

## Scope and release boundary

One primary image per product. The existing product editor supplies local preview, full-image/square crop, keyboard crop position, upload progress, explicit photo save, recovery/retry, replacement and removal. Photos appear in the POS picker, authenticated MICA Store catalog and inventory product detail. Empty, loading and failed-image fallbacks retain a fixed layout. New products are created through the existing form; open the saved product's editor to add its photo. Photo changes are deliberately separate from product-details changes and cannot update prices, stock, orders, receipts, wallets or accounting.

Branch `feat/product-photos-20261008`, draft PR #50, targets `feat/effective-access-workspaces-20261005`. Original integration commit: `4e75bf8883df592fee52e9521ab18a0f0c706f5a`; exact source tree `68adb211f5a71cf513eb34dde726244288e6cb13`. Continuation reconciles the base advance to `dacee1bf7a4f987d0aa4482d74a05511da5712b0` (merged PR #51). Its refund/login code and schema 052 are preserved; photo schema 051 is reserved independently and its timestamp sorts after 052. Deployment is disabled for this branch from its first commit. Existing deployment holds remain. PR #42/main release, stock-recovery migration 050 and disabled release/apply packages are separate workstreams. No historical migration is changed. No merge, deployment, hosted migration, storage provisioning, credential creation, maintenance change, scheduler or reopening is part of this implementation.

## Public visibility decision — required before provisioning

This adapter targets a **public Vercel Blob store**. Anyone who obtains a photo URL can view the image without a CampusPay session. The catalog API itself still requires the existing staff/customer session. Random object keys are not authorization. Public catalog images are appropriate only for non-sensitive product merchandise photos that the school is entitled to publish. **No student photos, people, identification, financial documents or other sensitive content.** Removing a photo does not retract copies already downloaded or cached elsewhere.

The operator must explicitly accept that public visibility **before** creating or connecting any store. Nothing is provisioned here. Public/private store access is chosen when provisioning; a private-store design would require a different serving adapter and separate review. Do not change a storage access mode or silently treat these URLs as private.

## Configuration names (no credential values)

Server-only photo configuration:

| Name | Purpose |
| --- | --- |
| `PRODUCT_PHOTOS_ENABLED` | Explicit feature enablement; absent/disabled leaves the existing catalog behavior intact. |
| `PRODUCT_PHOTOS_PUBLIC_ACCESS` | Explicit recorded public-visibility acknowledgment. |
| `PRODUCT_PHOTOS_ENVIRONMENT` | Storage environment: development, test or production. Must match the Vercel deployment context. |
| `PRODUCT_PHOTOS_NAMESPACE` | Application/store namespace, 3–48 lower-case letters/digits/hyphens, beginning with a letter or digit. |
| `PRODUCT_PHOTOS_BLOB_PUBLIC_ORIGIN` | Exact HTTPS public Blob origin of this environment's approved store; no trailing slash, path, query or wildcard. |
| `PRODUCT_PHOTOS_BLOB_READ_WRITE_TOKEN` | Server-only read/write token for that exact Blob store. Never prefix with `NEXT_PUBLIC_`. |

Enablement is recognized only as the literal `true`; public acknowledgment only as `acknowledged`. Vercel production maps to the production storage environment; preview maps to test; local development maps to development. Use **physically separate Blob stores and credentials** for development, test/preview and production, not just separate prefixes. The token's store identity is checked against the configured origin before the first write. Arbitrary Blob API endpoint overrides are rejected. Vercel's own deployment-context variables are read, not modified.

Existing `DATABASE_URL`, owner-only `DATABASE_URL_UNPOOLED`, origin/cookie configuration, session/HMAC secrets and runtime role remain as documented by the main application. No new photo credential belongs in a browser bundle, source file, log, screenshot, issue or PR. An empty configuration-name template is included here.

`PRODUCT_PHOTOS_LOCAL_TEST_STORE` is **isolated CI only**, not an operator/hosted configuration. It is accepted only with CI, the repository's localhost HTTP boundary, a loopback runtime database, a fixed synthetic Blob origin and a generated `/tmp/campuspay-photos-…` directory. It is rejected on every Vercel deployment. Native tests use it instead of real storage and Playwright serves those processed files under the synthetic origin. No paid store or real image is used.

## Upload and database design

Original files travel directly to the authorized server as a bounded raw request, never through a browser Blob upload token and never to public storage. Allowed inputs are JPEG, PNG and WebP. The server checks signatures, reads decoder metadata, fully decodes with Sharp and re-encodes fresh WebP outputs. Filename/browser MIME alone is never trusted. SVG/GIF, damaged files, animation and unsupported images are rejected. EXIF, GPS/location, orientation tags, ICC and XMP are not copied; orientation is applied before crop. No remote URL fetch/import endpoint exists.

Limits: 4,000,000 input bytes; 8192 pixels per side; 20 million decoded pixels; two processing tasks per Node process; Sharp worker concurrency one and bounded cache. The raw-body deadline is 10 seconds; decoder/encoder deadlines are 3/5/4 seconds; the upload operation has a 45-second abort budget and the route a 60-second maximum. Display output is at most 1280 pixels / 2,000,000 bytes; thumbnail at most 384 pixels / 500,000 bytes. Both preserve aspect ratio unless the operator selects a square crop. The public Blob cache lifetime requested is 60 seconds.

Every mutation rechecks `inventory.product.manage` at the HTTP/server and SQL boundaries, preserves origin/CSRF and terminal/session checks, and uses the established staff-administration lock order. Persistent rate limits are 12 changes/uploads per staff member per minute and 60 globally, including pre-decode attempts. No capability is granted to a new role. GET/read/catalog permissions retain existing semantics.

`051_product_photos.sql` / `20261008090000_product_photos.sql` add four private tables and six functions (three private helpers, three narrowly exposed API functions). Tables contain references, dimensions, byte counts, hashes, lifecycle state and opaque request identities only: **no image bytes/base64**. Runtime access is execute-only; tables/private helpers are denied. API functions are SECURITY DEFINER with a pinned empty search path and explicit grants. Migration checks fail on unexpected object owners, ACLs or grant options. It requires the schema-050 recovery function and the same owner as `public.products`.

Generated paths are `campuspay-products/{environment}/{namespace}/{product UUID}/{asset UUID}/{display|thumbnail}.webp`. Asset IDs come from the database. Browser requests cannot supply an object key, URL, namespace, deletion target or cleanup token. The Blob SDK is behind one small adapter; no provider types leak into the editor or financial domain.

## Concurrency and interrupted operations

A durable reservation is committed **before** any provider PUT. Only its creator may write its immutable keys; duplicate requests only recover state. Validation and storing do not change the current photo. The explicit save uses a locked revision comparison: a concurrent winner remains current and the loser is retired. SQL links and audit events commit atomically. A failed database save leaves the prior photo linked and the staged candidate available for recovery.

The browser records an opaque request UUID in session storage before submission, scoped to the staff user and product. Missing safe storage blocks mutations rather than losing recovery. A synchronous gate prevents double clicks; stale response generations and lower revisions are rejected. Unknown outcomes block fresh changes until checked/cancelled. Reloading recovers the original request, including a save that committed after the response was lost. Cancellation can write a tombstone before a delayed upload arrives; it never rolls back an already-saved result. Operation rows are retained, so an old successful request cannot recreate a deleted object or resurrect an old photo.

Unsaved photo work blocks internal record/product actions; closing/reloading warns, and navigation still leaves the server-side operation recoverable. Unrelated product detail drafts survive a confirmed photo save. A local unsaved file is not persisted; a failed attempt can be reselected/retried after its original request is resolved. Staged operations expire after 20 minutes. At most three pending assets per product and 500 non-live/non-deleted assets overall can accumulate before additional uploads are blocked pending cleanup.

## Bounded cleanup — no automatic scheduler

An authorized, same-origin POST of an empty JSON object to `/api/inventory/product-photos/cleanup` performs **one batch**, at most five assets / ten exact generated keys. There is no cron job, timer, remote-object listing, arbitrary URL deletion, or unbounded loop. Invoke only from a legitimate authenticated inventory-management session under the operator's approved maintenance procedure; do not paste a session cookie into a repository or PR. The response exposes only counts (`claimed`, `deleted`, `deferred`), not credentials or internal targets.

Abandoned and retired objects have a 24-hour grace period, intentionally much longer than the 60-second producer lifetime. Cleanup takes the same product lock, rechecks that no current state references an asset and irreversibly marks it DELETING before touching storage. Five-minute leases and unique claim tokens allow retry after interruption. Stale acknowledgments fail; a claimed/deleted asset can never become current. Failed deletion/acknowledgment is deferred for a later explicit batch. Current LIVE objects are never eligible, even when timestamps are old. The grace is a producer-lifetime assumption, not a claim that third-party storage can provide distributed transactions or retract cached copies.

Monitor deferred counts and pending-cap errors. Resolve missing/wrong-store configuration before cleanup; never substitute another store or broaden the delete path. Disabling the feature does not delete image objects or database evidence. Product archival does not delete records or their current photo; cleanup targets only retired/abandoned photo assets.

## Migration and setup/release checklist

1. Keep this draft and all existing deployment holds. Review the final exact-head CI evidence and screenshots; reconcile any integration-base advance before approval. Public storage provisioning, credentials, migration execution, merge and deployment each remain operator/release-owner actions.
2. Obtain explicit approval for public product-image visibility. Provision/connect separate development/test/production stores only under that approval. Set the six server-only configuration names in the intended Vercel project/environment; leave the feature disabled until schema and smoke checks are ready. Do not expose a production token to preview environments.
3. Coordinate with the schema-050/release owner. Verify the expected current migration history through `20261008070000_refund_login_hardening` (including stock recovery 050), exact target, owner/ACL defaults, recoverable backup and fresh maintenance evidence. The existing owner runner's same-connection advisory lock and per-migration transactions must be retained. **Do not apply 051 to a database whose prior migration is different, edit 050 or 052, or splice this into another disabled apply package.**
4. On an approved disposable/local rehearsal, run `node scripts/migrate.mjs --preflight --check-runtime`, inspect that only the expected new migration is pending, then use the existing runner for the separately approved application. In production, stop here until the release owner approves a reviewed apply procedure. This implementation ran no hosted migration.
5. Independently verify migration 051's owner, private-table denial, exact API execute grants/search paths and migration-history entry. Rehearse a synthetic upload, save, lost-response recovery, replace, remove and one bounded cleanup batch in the test environment. A credential-free fake-storage test does **not** prove a provisioned Blob store's configuration.
6. Only after separate release approval, merge/deploy the qualified source and enable the appropriate environment. Verify POS/store/editor with synthetic merchandise and image failure fallbacks, and then follow the existing release/maintenance reopening process. Applying 051 alone does not authorize or establish that CampusPay is ready to reopen.

Rollback strategy: turn off the photo feature in a separately approved configuration change; the previous catalog paths remain usable without photos. Preserve metadata, tombstones and Blob bytes for investigation. Do not down-migrate/drop these tables, delete financial/product records or undo migration 050.

## Qualification and evidence

`npm ci`, static checks, type checking, the complete Vitest suite, lint, build, runtime dependency checks, native migrations/readiness and existing regression scripts run against the exact checkout in `.github/workflows/product-photo-validation.yml`. Jobs use read-only repository permissions, disposable PostgreSQL 17, pinned actions and no hosted credentials. Runtime and complete dependency-audit gates remain visible and unchanged; artifact-upload failures are not suppressed.

`node scripts/verify-product-photos.mjs` exercises actual compiled routes/components with synthetic data and the real disposable database, including ACL/owner failure rehearsals, authorization/origin errors, content/size limits, idempotency, concurrent edits, save/storage failure, expiry, cancellation, leased cleanup, no-photo fallback and desktop/mobile browser response-loss recovery. Protected product, price, stock, receipt, wallet and sale-table snapshots must match before/after. It also verifies missing storage configuration in a separate fresh database. It records commit/tree identities, assertions, expected injected network failures and PNG screenshots under `.validation/product-photos/`.

Screenshots and final test results belong to the exact-head CI artifacts and the PR qualification comment, not a self-referential hard-coded commit inside the source. Earlier runs are diagnostic only and do not certify a later commit. Live Blob credentials/provisioning and hosted migration/deployment smoke checks are intentionally unexecuted operator steps, not passing tests.
