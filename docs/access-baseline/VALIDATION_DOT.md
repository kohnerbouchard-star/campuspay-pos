# Dot continuation: bounded acceptance and security review

Continuation date: 2026-10-05. Repository: `kohnerbouchard-star/campuspay-pos`. Continue on owned draft PR [42](https://github.com/kohnerbouchard-star/campuspay-pos/pull/42), branch `feat/effective-access-workspaces-20261005`.

The saved handoff head was `13d85fc3472b63ac07655f79ef85176c4611db58`; main remained `32c7ed61213e3aba37c14291174f379dde548677` when this continuation began. Open PRs 41, 33 and 34 were inspected for overlap and not imported. No checkout `AGENTS.md` or `.agents/skills` guidance was present. This is one bounded worker, with no Econovaria application work.

## Acceptance additions

- `scripts/funding-browser.mjs` checks both a normal successful deposit and a committed deposit whose response was lost, followed by reload and recovery. Each must show the matching student's receipt, update the selected detail balance, and appear exactly once in wallet history with the exact amount and balance. Native queries cross-check the selected wallet, single operation and matching ledger entry. Existing scanner rerender, duplicate Enter, native frame, opaque storage, corrupt storage and financial assertions remain.
- `scripts/verify-access-workspaces.mjs` captures Customize Access and the exact save review at 1440, 768 and 390 pixels, plus each matrix workspace on a phone. It checks dialog overflow and the actual permission diff. Reviewed saving now also simulates committed response loss, verifies storage contains only the request key, reloads, recovers the result, and proves one immutable access event and immediate revocation of the target's old session.
- Effective Access screenshots still cover all three widths. The nine preset/custom profiles, direct-route denial before protected fetches, API/RPC denial, read-only controls, dependency addition/removal and unchanged financial footprint remain required.

Local visual review exposed inherited `white-space: nowrap` clipping permission descriptions, including in the stacked phone matrix. `src/app/usability.css` now wraps descriptions within the access matrix and keeps checkboxes from shrinking; browser assertions check each matrix area for horizontal clipping. Screenshots capture the viewport so modal states remain readable rather than being scaled down within a long background-page image.

No application financial code, capability defaults, migrations, dependency policy or authorization guards were changed in this continuation.

## Security review

Reviewed the 113 entries in `current-routes.json`, 96 function entries in `current-database-boundaries.json`, the corresponding route/domain/session code, and the functions actually installed by all migrations in disposable PostgreSQL 17. Empty direct-guard entries in the route inventory include named domain helpers (`cashSession`, `administrationSession`, `managementSession`), customer-session routes, and login/logout; the inventory is an aid, not the authorization implementation.

- Installed ordinary operations resolve stored capabilities. The legacy role-permission functions have no ordinary authorization callers. The unused TypeScript legacy role matrix is not imported by runtime code.
- Remaining role predicates cover Super Admin access administration, protection of Super Admin credentials and the last administrator, forbidding role changes through profile edits, stale session snapshots, and bootstrap/backfill metadata. Timeouts retain legacy role metadata.
- Access changes drain affected sessions before profile/access writes, check previous revision and snapshots, require current PIN and explicit access authority, prohibit self edits and open-drawer changes, revoke sessions and write immutable before/after audit. Recovery remains actor/terminal bound.
- Contextual funding binds the selected identity before card verification. Posting retains current capability/session, student/card/PIN, original drawer, source/reason, independent correction approval, wallet floor, ledger/cash receipt, replay and recovery checks. No approval bypass or balance cleanup was added.
- Installed API functions use security definer with an empty search path. `campuspay_runtime` has no executable private functions. Native tests deny private table access and sensitive unassigned RPCs, reject self-approval in installed dual-control operations and reject immutable audit updates.
- Historical migration files are unchanged; only the five existing forward migrations 045–049 differ from main. Reserved schema 044 remains untouched.

Local installed-function dump SHA-256: `d7ea839e019a8ab729edf5955122245e4a226c64e4ba6ffd4f4fd59765e24b27`. This identifies a synthetic review artifact, not a production schema attestation.

## Evidence and remaining release boundary

The handoff's exact-head access workflow [37263454897](https://github.com/kohnerbouchard-star/campuspay-pos/actions/runs/37263454897) passed native access and all five regression groups, including the scanner repair and nine-profile acceptance. New commits require their own exact-head workflows; the PR body records the final candidate/tree and run URLs after the push.

Local checks use a production build, a disposable PostgreSQL 17 container bound to localhost, randomly generated synthetic identities/credentials, and Chromium. They never connect to a hosted database. Evidence is generated under `.validation/funding/`, `.validation/access/` and `.validation/access-workspaces/`; CI uploads these under `regression-funding-history`, `access-validation-results` and `regression-navigation-administration`.

The GitHub artifact download for the handoff returned HTTP 403 from artifact storage. It was not retried through another tool or environment. Local synthetic browser runs provide inspectable screenshots; remote artifact visual inspection remains explicitly unverified if download access is unavailable. CI status alone does not establish visual inspection of its artifact bytes.

The documented exact-project Vercel denial remains respected and was not bypassed. PR 42 stays draft and unmerged. No deployment, hosted migration, credential/access-setting change, production write, feature activation or irreversible data change is authorized by this continuation. The coordinated database/app maintenance cutover in `release-cutover.md` still requires separate approval and verified access. All unrelated engineering/production items explicitly listed in `HANDOFF_DOT.md` remain open.
