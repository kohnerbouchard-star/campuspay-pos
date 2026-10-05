# CampusPay effective access refactor evidence

Baseline GitHub main: `32c7ed61213e3aba37c14291174f379dde548677`.
Baseline tree: `3b3b9f8c171c2eacc20ba0eb13dd5d7de711253b`.
Main rechecked on 2026-10-05 and remains at that commit. The exact source was recovered from the successful validation artifact, its digest verified, and its git tree reproduced before editing. This preserves the newer legitimate record-management and receipt-recovery work on main.

Scope: only `kohnerbouchard-star/campuspay-pos`. Deployment is limited to Vercel `campuspay-pos`, project `prj_wXkpTGGYjL6emMhAX6RSwxkafkME`, team `team_PRsNkw4DHrGsUHl6ikKw2XyJ`. Direct project lookup returned 404 and deployment listing returned 403. No alternate project or deployment was attempted. GitHub's existing baseline Vercel status is successful; this does not establish connector authorization to deploy.

## Baseline inventory

- `authorization-locations.txt`: role checks, permission checks, page and API guards before edits.
- `routes.json`: every page/API route and its authorization guard.
- `database-boundaries.json`: database function authorization inventory.
- `legacy-mapping.json`: exact explicitly stored migration assignments per old role.

Baseline roles: cashier, inventory_admin, accountant, super_admin. Baseline capability names are retained only as legacy contract metadata; they no longer resolve runtime authority from a role.

Baseline navigation had 14 primary destinations. The candidate has five primary workspaces: Register, Students, Inventory, Finance, Admin. Sections and actions use individual effective capabilities. POS is still the immediate checkout destination.

Relevant existing work reviewed: open PR 41 (recoverable deletion; failed validation), older overlapping open PRs 33/34, and merged record management (38), visual refresh (40), receipt recovery (37), navigation (36), API recovery (35), security (24), Next security (22), reconciliation (21). The candidate preserves main and does not import failing unrelated changes. Schema number 044 is reserved for the open deletion work.

Baseline latest scheduled CI run 37245615923 and push run 37176922509 were successful. Candidate validation is separate and must pass before merge.

## Migration strategy

Five forward-only migrations (045–049) preserve historical migrations:

1. Explicit effective access, capability catalog and four default presets. Existing employees receive the reviewed old-role semantic mapping, not the new preset defaults. Every pre-migration staff session is revoked.
2. Installed RPC capability boundaries. Counted function edits abort if an expected installed function body differs, preserving the transaction bodies and lock ordering.
3. Immutable employee access audit and recovery closures. Access changes require current Super Admin credentials, explicit access-management capability, a target, previous snapshots/revision, proposed snapshots, reason and confirmation. Target sessions are drained and revoked. Concurrent stale edits fail. Self changes are forbidden; final usable administrators are protected.
4. Separate staff, terminal and payment configuration capabilities. Legacy profile operations cannot change an employee's role. Ordinary staff managers cannot take over a Super Admin's credentials.
5. Contextual normal funding preparation, selected-student identity binding and readiness. Existing card/PIN, drawer, ledger, cash journal and response-loss recovery logic stays authoritative.

No production migration has been applied. No balances, stock, production credentials or feature activations were changed.

Preset defaults are convenience snapshots. Updating defaults cannot update existing assignments. Explicit reset shows the proposed differences and uses the audited access-change operation.

The legacy adjustment component is unmounted from the primary UX. New legacy posting RPCs require a retired permission that is never assigned. Historical receipt recovery remains supported. There is one normal-deposit journey: Students → selected Student → Add Funds.

## Validation status

This branch is implementation in progress. Initial local results: 449 unit tests pass; navigation tests pass; typecheck, lint, static/import/security checks pass; all migrations apply in an isolated PostgreSQL-compatible runtime. Native PostgreSQL 17 CI, full browser regression, exact-candidate security review and actual-main validation are still required. The draft PR must not be merged until these pass.

## Explicitly unresolved scope

Stock-removal unknown-result recovery, card-issued/missing-PIN lifecycle repair, demo/opening-position cleanup, persistent server-backed picking, full order-history pagination, formal stocktake, guided end-of-day, academic-year rollover, physical hardware acceptance, production monitoring/alerts and remaining production completion tracker work stay open unless separately implemented and validated. UX consolidation does not complete them.
