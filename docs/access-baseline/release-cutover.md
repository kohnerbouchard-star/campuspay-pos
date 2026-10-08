# Coordinated CampusPay release

Only repository `kohnerbouchard-star/campuspay-pos`, Vercel project `campuspay-pos` (`prj_wXkpTGGYjL6emMhAX6RSwxkafkME`) and team `team_PRsNkw4DHrGsUHl6ikKw2XyJ` are in scope. The separate Econovaria application is excluded.

The application and effective-access schema must be released together. The new app returns a safe HTTP 503 database-upgrade message for legacy staff authentication results without `preset` and `access_revision`; it does not reconstruct authority from old roles. Conversely, an old app is not a supported operating client after the new schema retires legacy permissions. Applying a schema and leaving an unmatched production app running is not a safe rollout.

## Prerequisites

- Both exact-candidate CI workflows pass, including native PostgreSQL, browser, financial recovery, migration, audit and backup/restore validation. Record candidate commit and tree separately from the GitHub PR merge-test commit/tree.
- Recheck actual main and preserve legitimate intervening changes. Validate the actual merged main separately if merge occurs.
- Establish authorized access to the exact CampusPay Vercel project and its existing CampusPay database, without exposing secrets. Verify the database host/project identity against deployment configuration before any migration.
- Obtain a verified encrypted backup through the existing backup process. The CI restore test proves the synthetic process, not that a production backup exists.
- Prepare a maintenance window with no student/staff posting. Resolve uncertain payment, funding, receipt, refund and administrative results with original operator/register recovery. Close affected drawers through their normal verified workflow. Preserve receipts, ledger and recovery journals; do not clean up demo/opening data.

## Cutover

1. Keep staff and MICA Store writes quiescent throughout the schema/app transition. Do not change unrelated feature activations, credentials, domains, secrets or data.
2. Run the existing migration preflight against the verified CampusPay database. Review old-role mapping in `legacy-mapping.json`; new employee presets are not backfilled onto existing employees.
3. Apply only the five forward-only migrations 20261005090000 through 20261005094000 with the existing migration runner. Historical files and reserved schema 044 remain unchanged. Migration 045 revokes old staff sessions and records each migrated access assignment.
4. Release the validated app/main SHA to the exact project and record its deployment identity. Verify the matching schema, grants, session revision checks and activation readiness before reopening operations.
5. Staff sign in afresh. Verify least-privilege workspace/section visibility, employee access review, and safe funding readiness without mutating real school balances or inventory during automated smoke tests.
6. Reopen normal use only after the deployment and database checks are complete. Monitor the existing operational controls and retain all audit/recovery references.

If a migration or release fails, keep maintenance closed and fix forward. Do not rewrite historical migrations, resume an old app against a partially upgraded schema, or improvise another Vercel project. Production restore would be a separate destructive operation requiring its own concrete review.

## Observed release blocker

Direct Vercel lookup of the exact project returned 404 `Project not found`; listing its deployments under the exact team returned 403 `Unauthorized`. GitHub's automatic Vercel status does not grant connector access or establish a coordinated database/app cutover. No production migration or manual deployment has been attempted. Keep PR 42 unmerged until exact-candidate validation and this cutover can be completed safely.
