# Isolated UI fixes — review and validation boundary

Base: `4e55ece88cb0afcc3e85c8f0436f8d346f5c40a1` (tree `25041b33225b68a95b8f54d8e59e23b0cd624e3e`).
Branch: `fix/ui-student-access-readiness-20261007`. This is a separate, stacked **draft** PR; it is not a change to PR #42's branch or qualification.

The student directory stays mounted. Native modal details appear as a right-side desktop drawer or a full-screen mobile view. The directory's search, year filter, page and scroll survive close; focus returns to the current row DOM node, including after a refresh replaces it. Native row buttons support Enter/Space. The shared `.table-panel` full-width layout is intentionally unchanged. Nested dialogs retain their own focus and Escape handling. Add Funds remains capability filtered.

Unsubmitted funding/status drafts require explicit discard confirmation. Loading recovery storage, an in-flight operation, an unresolved key or corrupt storage prevents closing/changing the active workflow. Reload retains the existing opaque recovery marker, and before-unload protection warns before leaving an active workflow. No recovery endpoint or authorization implementation is changed.

Employee access display is separate from the immutable profile editing target. Confirmed and recovered saves notify the parent even if the editor's own refresh fails. Reads are identity-checked; stale results cannot overwrite a later selection. Failed refreshes replace the selected permission display with a stale warning and a GET-only retry. Unrelated profile inputs and their original optimistic concurrency checks remain intact.

Funding readiness has its own loading/error/retry state, independent of successful data and of the transaction/journal revision. A retry does not remount or clear a draft, prepare a request or confirm a deposit. Requests are single-flight and aborted/identity-fenced across student or revision changes. Posting and card-verification controls stay disabled without valid current readiness; original-result recovery remains available. An intentional readiness refresh may require a fresh scanner frame, because financial controls are disabled during the GET. The existing native scanner regression still checks a complete frame across a harmless UI rerender, duplicate Enter and actual scanner posting.

## Tests

`node --experimental-strip-types --no-warnings scripts/verify-ui-fixes.mjs` bundles the actual UI components with the already locked Vite dependency, serves them on a loopback-only fixture server, and intercepts all API requests with synthetic responses. It covers desktop/mobile layout, keyboard/focus restoration, list state, capability visibility, draft warnings, opaque funding recovery, initial/repeated GET failure, single-flight retries, late responses on student changes, ordinary/recovered employee saves, refresh failures, retained profile drafts, and explicit zero-mutation assertions for retries. Its fixture is outside `src/app` and is never an application route. This suite is not a replacement for native server authorization or financial integrity tests.

The added test-only workflow checks out and records the **exact head SHA and tree**, then runs typecheck, lint, unit tests, static/API checks, build and the fixture suite. A separate job runs the existing native PostgreSQL 17 authorization, funding, navigation, administration and management browser suites in their disposable localhost harnesses. Both jobs upload evidence. No hosted database URL or secret is used. A test being committed is not a claim that it passed; final results belong in the draft PR and its exact-head workflow runs.

## Migration/release coordination

PR #42 and its qualified commit remain unchanged. Database files, existing release/maintenance scripts, migration-preparation launchers/packages/manifests and the existing release-cutover documents are untouched. This UI branch does not approve, prepare, reserve or execute a production migration attempt. The separate migration-preparation work must continue against its own pinned artifacts. Do not silently replace its qualified application reference with this branch.

No merge, manual deployment, feature activation, maintenance change or production access is authorized by this work. The existing Git integration nevertheless reported a successful Vercel deployment for the initial push (`d3f7b7c`). A deny-only `vercel.json` rule now disables automatic deployments for this exact fix branch; it does not enable deployments or change any other branch. The reported deployment was not opened, tested or promoted. Adoption of this patch needs separate review and qualification; GitHub preview status is not release evidence.
