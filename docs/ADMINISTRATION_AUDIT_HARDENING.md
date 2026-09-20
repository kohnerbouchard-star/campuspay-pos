# PR 12 administration audit hardening

Scope: the two administration risks identified in the 18 September audit, plus the related same-terminal login lock inversion and editor discoverability. No live database migration, feature activation, demo cleanup, roster import, credential issuance, hosting or financial transaction is part of this change.

## Lock order

The forward-only `20260920100000_administration_lock_order` migration leaves all previously published migrations unchanged. Administration acquires the existing lifecycle advisory lock, performs a non-locking preliminary authorization check, locks the complete affected session set in UUID order, and then revalidates the actor with `assert_session`. It does not hold a profile or terminal lock while waiting to drain target sessions. Profile and terminal IDs are not modified, so their explicit locks use `FOR NO KEY UPDATE` to avoid blocking unrelated journal foreign-key references unnecessarily. Open-drawer guards and session revocation execute after the drain.

Login uses the same lifecycle lock and drains an existing terminal's sessions before credential verification and its terminal upsert. This prevents the former terminal-then-session order from conflicting with an in-flight operation's session-then-terminal order. The migration preserves the existing login implementation and verifies the exact patch precondition before changing it. Authentication, PIN lockout, request recovery, roles, original journals and default-off feature gates remain intact.

## Editing snapshot

Each explicit editor selection creates a cloned record snapshot and a new editor key, even when selecting the same staff member or terminal. Uncontrolled form values and optimistic preconditions therefore reset together. Directory refresh alone does not replace an open draft's original preconditions: an old submission must be rejected by the database, not silently overwrite a newer role, active status or terminal label. Reselection clears the prior draft, PIN fields and acknowledgment. The named editor moves focus and scroll position to its heading when opened.

## Regression coverage

`verify-administration-hardening.mjs` uses the existing CI-only, localhost-only disposable database context. It runs in addition to, not instead of, the prior administration, enrollment, refunds, operations and complete integration/browser suites.

`administration-locking.mjs` uses independent PostgreSQL connections and `pg_blocking_pids` as a deterministic barrier. Two negative controls install the actual published pre-fix administration function or remove only the login-drain correction inside this disposable database and require PostgreSQL deadlock code `40P01`. The fixed definitions are restored in `finally`. The corrected implementation is then exercised against cash opening, actual cash checkout, staff edits, PIN reset, staff/terminal revocation, terminal deactivation and login replacement, including administration-first schedules. Committed cash checkout must produce one sale and exactly one attributed cash event. Timeouts bound failures; they are not used to guess when overlap occurs.

`administration-editor-browser.mjs` uses two separately authenticated administrator browser contexts. It checks rejection of an old draft after another operator changes a staff role/active status or terminal label/active status, reselection of that same refreshed record, successful edits that preserve the newer access state, clean credentials/acknowledgments, and explicit editor focus. Four viewport widths retain the horizontal-overflow and browser-error checks.

Evidence is written under `.validation/administration-hardening/`. Exact commit, workflow IDs, actual pass/fail results and any limitations belong in the PR delivery record; this document is not a claim that an unrun test has passed.
