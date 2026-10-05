# CampusPay implementation handoff to Dot

The user requested a handoff on 2026-10-05. Work is saved on GitHub; this is an incomplete implementation/validation handoff, not a release-completion claim. Continue from the existing branch and draft PR. Do not restart from the old audit or develop directly on main.

## Exact repository and release boundaries

- Repository: `kohnerbouchard-star/campuspay-pos`
- Branch: `feat/effective-access-workspaces-20261005`
- Draft PR: https://github.com/kohnerbouchard-star/campuspay-pos/pull/42
- Baseline main, rechecked immediately before handoff: `32c7ed61213e3aba37c14291174f379dde548677`
- Baseline tree: `3b3b9f8c171c2eacc20ba0eb13dd5d7de711253b`
- Latest implementation candidate before this documentation-only handoff commit: `a15f0f0f94ef47c40c0595c558bb7e2ae4e9d464`
- Implementation tree: `e1216b9b9ddc6d2ac2ce1b1f7eb8187309350ba9`
- The handoff commit/tree and definitive latest CI state are in PR 42. Read the remote branch head; local reconstruction commits have different commit hashes but identical trees.
- Vercel project ONLY `campuspay-pos`, ID `prj_wXkpTGGYjL6emMhAX6RSwxkafkME`; team `Econovaria`, ID `team_PRsNkw4DHrGsUHl6ikKw2XyJ`.
- Do not inspect destructively, change or deploy the separate Econovaria application or any unrelated repository/project.
- No merge, production migration, manual production deployment, balance/stock/credential modification, demo cleanup, secret/domain/plan change or feature activation was performed.

Fetch current legitimate main before continuing, preserve any newer changes and never reset main to the baseline. Schema 044 remains reserved for open PR 41; its failing deletion work was not imported.

## Implemented

1. Five effective-capability workspaces replace 14 primary staff navigation destinations: Register, Students, Inventory, Finance, Admin. POS remains immediate for assigned operators. Sections, record actions, pages, API/domain services and installed database functions have independent guards.
2. Four presets seed explicit per-user stored capabilities: Staff, Manager, Accountant, Super Admin. Existing employees receive the reviewed legacy semantic mapping, not broader new defaults. Runtime authority never inherits a role/preset bundle or a later default change.
3. Forty-seven installed capabilities with semantic View/Operate/Manage/Approve cells, recursive prerequisites and removal of dependents. Exact defaults/catalog/dependencies are in `capabilities.json`; exact backfill is in `legacy-mapping.json`.
4. Admin → Staff → Employee → Access provides Preset, Customize Access and Effective Access views, Customized status, explicit reset defaults, before/after review, reason, target confirmation, fresh current Super Admin PIN, immutable audit and opaque unknown-result recovery. Self access editing is forbidden; another authorized Super Admin is required.
5. Access changes revoke all target staff sessions and advance the revision checked by session authorization and database RPCs. Final usable administrator, final active Super Admin, current-terminal and open-drawer protections remain. Staff profile editing cannot change roles; ordinary staff managers cannot take over Super Admin credentials.
6. Students → selected Student → Add Funds is canonical. The selected student is bound server-side; readiness distinguishes authorization from activation/drawer/student/card/PIN blockers. Normal funding, correction, reversal and independent approval are separate. Existing ledger, immutable receipt/cash journal, PIN/card, source/reason, floor, operator/register binding and idempotent recovery are retained.
7. Legacy AdjustmentPanel has no mount/import in the primary UI. `/accounting` redirects to Students; legacy posting requires retired `wallet.adjust`, which is never assigned. Historical receipt recovery remains available under its guard.
8. Product-centered inventory and separated read/issue/cash-handover refund controls. Employee details include derived effective access for staff viewers; read-only users receive no mutation controls. Customer/staff cookie and origin separation remains.
9. Older database staff authentication results lacking `preset`/`access_revision` fail closed with safe 503 DATABASE_UPGRADE_REQUIRED. No legacy role fallback is permitted. A matching database/app cutover is mandatory.

## Forward-only migrations

Each new schema module has a matching timestamped migration. Historical migrations are unchanged.

- 045 / `20261005090000_effective_access.sql`
- 046 / `20261005091000_capability_boundaries.sql`
- 047 / `20261005092000_staff_access_management.sql`
- 048 / `20261005093000_administration_capabilities.sql`
- 049 / `20261005094000_contextual_student_funding.sql`

Counted edits to installed function definitions abort on unexpected bodies; they preserve transaction bodies/lock ordering. Migration 045 explicitly records migration assignments and revokes old staff sessions. No production schema was migrated.

## Validation state at handoff

Local: typecheck, lint (two non-blocking unused-variable warnings), static/import/security/schema checks and 452 unit tests passed. All migrations also applied in temporary PGlite with pgcrypto; this is supplementary, not a native PostgreSQL substitute.

Native PostgreSQL 17 effective-access CI passed for the latest implementation candidate. It verifies exact legacy mappings/defaults, invalid/dependent assignments, no dynamic preset inheritance, stale/self/unauthorized edits, session revocation and immutable audit, runtime grants, and installed dual-control operations.

Latest implementation runs, still in progress when the user requested handoff:

- Full existing suite: https://github.com/kohnerbouchard-star/campuspay-pos/actions/runs/37263087569
- Native access + five regression groups: https://github.com/kohnerbouchard-star/campuspay-pos/actions/runs/37263087550

The documentation-only handoff push triggers fresh CI. Verify that final exact candidate separately; do not call it passing merely because an earlier candidate passed.

Immediately previous candidate `a9204f831768bf45e2e028e74ea54c47c8691061` passed native access, management/security/initial enrollment, refunds/operations/partial refunds, navigation/administration, integration/customer journeys/old-schema safety, history/reconciliation, receipt recovery and encrypted backup/restore groups. Funding browser regression failed: readiness resolved to duplicate sections. Its regression exposed duplicate sibling React keys, not a financial posting error. Latest implementation uses unique `readiness:${revision}` and `form:${revision}` keys; exact frame survival across rerender, duplicate Enter rejection, native scan and response-loss recovery assertions are retained. This fix must pass the latest workflow.

The latest candidate also expands contextual funding acceptance (closed drawer, inactive account, missing initial PIN, another valid card and wrong PIN with unchanged monetary footprint), adds a ninth read-only Admin profile, and displays derived effective access in employee details. These additions are awaiting final exact-candidate browser results.

## Next steps for Dot

1. Inspect both latest CI workflows and artifacts, then fix any remaining failures without weakening meaningful assertions. Read each regression failure file/log rather than treating expected database denial logs as test failures.
2. Finish the funding browser/scanner regression. Inspect `.validation/funding/{failure.txt,reader-diagnostics.json,failure.png}` if it fails. Diagnostics store equality/length only, never card values. Preserve opaque recovery after commit/response loss/reload, corrupt-storage denial and no double credit.
3. Inspect nine-profile workspace/access browser results in `.validation/access-workspaces/`. Preserve unauthorized direct-route denial before protected fetches, API/RPC denial, read-only UI, dependencies, reviewed save, audited changes and revoked sessions. The preceding eight-profile run passed.
4. Inspect desktop/mobile screenshots from the exact passing artifacts. Current access screenshots are taken on the Effective Access tab; capture Customize Access matrix and review states too if fuller visual evidence is needed. Extend explicit receipt → updated student balance → wallet history browser assertions if needed; current receipt/recovery and database integrity checks are present.
5. Finish security review against `current-routes.json`, `current-database-boundaries.json`, source and the installed native functions. Intentional remaining role checks concern Super Admin-only access/creation, stale snapshots/timeouts and historical bootstrap metadata. Ordinary authority is effective-capability based.
6. Review `release-cutover.md`. New app + old schema fails closed; old app + new schema is not a supported operating combination. Do not merge into an automatically deployed production main without a verified coordinated CampusPay database/app maintenance cutover.
7. Once both exact-candidate workflows pass and release access is available, update PR evidence with candidate/tree, mapping/catalog, tests, screenshots, limitations and cutover. Merge only after exact-candidate validation; validate actual main separately and deploy only the exact project. Otherwise leave unmerged and report the blocker accurately.
8. Produce the user's requested completion report only when the corresponding evidence exists. Keep incomplete items explicitly open.

## Deployment authorization blocker

Rechecked at handoff: exact Vercel project lookup returns 404 `Project not found`; exact team/project deployment listing returns 403 `You don't have permission to list the deployment.` The GitHub Vercel integration may create branch previews automatically; those statuses do not establish connector access or production database readiness. No fallback project or workaround deployment was attempted.

## Evidence and policy notes

- Baseline: `authorization-locations.txt`, `routes.json`, `database-boundaries.json`.
- Candidate: `current-routes.json`, `current-database-boundaries.json`, `capabilities.json`, `legacy-mapping.json`, `route-mapping.md`, `security-review.md`, `release-cutover.md`.
- Original full validation workflow retains financial, migration, browser, static, dependency, integration and backup/restore gates. Supplemental access workflow runs independent groups with fail-fast disabled and reports every group's failures.
- The existing exact expiring development dependency exception for the unresolved braces advisory is unchanged. Runtime dependency audit is separate. Do not broaden the exception or remove audit gates.
- Refund policy currently has no independent refund-approval workflow: explicit read/issue/cash handover were separated while preserving installed verified tender rules. Do not claim `refunds.approve` is implemented. Formal stocktake/variance approval is likewise not implemented.

## Explicitly unresolved engineering/production work

Stock-removal unknown-result recovery; card-issued/missing-PIN lifecycle repair; demo/opening-position cleanup; persistent server-backed picking; full order-history pagination; formal stocktake; guided end-of-day; academic-year rollover; physical hardware acceptance; production monitoring/alerts; remaining production completion tracker work. Navigation consolidation does not complete any of these.
