# Deliberate staff and terminal administration

This is code and isolated acceptance-test delivery, not live account provisioning, a demo cleanup, or production activation. The migration and application gate `ADMINISTRATION_ENABLED` default off. Student identities, cards, PINs, wallets and historical financial records are outside this feature.

The staff workspace provides a paginated directory and deliberate named-account creation, role/name/active-status changes, PIN resets, and session revocation. The terminal directory supports labelling, active status and session revocation. Each write requires Super Admin authorization, that administrator's current PIN, an explicit identity confirmation, and a reason. PIN verification uses the existing HMAC/bcrypt and lockout mechanism; a wrong step-up PIN commits its failed-attempt counter. There are no generated/default live credentials. Hand over the selected staff PIN privately after verifying the recipient.

Staff changes revoke that person's sessions; terminal changes revoke sessions on that terminal. Renaming the current active terminal does not sign out the current administrator. Self-deactivation, self-reset, self-revocation and current-terminal deactivation/revocation are refused. An active administrator must remain. A terminal with an open cash drawer cannot be disabled; a cashier with an open drawer cannot be deactivated or have their role changed. The global lifecycle lock coordinates login and administrative changes; target session locks wait for in-flight operations before checking open drawers and revoking access. Stale profile and terminal edits fail rather than silently overwrite another operator's change.

A registered terminal represents a browser token, not an immutable physical machine identity. Revoking that token is not advertised as hardware admission control: an authorized employee can sign in through a new browser token. No automatic terminal approval or guessed school-device inventory is added.

Operations are immutable and bound to the original administrator, terminal and opaque request key. Duplicate submissions return the recorded result; different replays conflict. Recovery returns the recorded result or closes an uncommitted request under the same lock, preventing a delayed request from executing afterward. The browser stores only the opaque request key, never a PIN, name or role-change payload. Unavailable or corrupt recovery storage blocks writes. A confirmed mutation followed by a failed directory refresh remains confirmed and does not invite a duplicate.

The API returns no credential hashes, PIN proofs, terminal fingerprints, cookies or session tokens. Audit events contain only safe action, reason and session-count metadata. Private operation tables are not readable by the runtime role.

## Acceptance evidence

`verify-administration.mjs` refuses non-CI/non-local targets and creates an isolated disposable PostgreSQL database with synthetic identities. It covers application/database gates, role/origin denials, step-up failure persistence, concurrent duplicate creation, changed and cross-actor replay, case-insensitive employee-code collisions, stale edits, PIN/role/deactivation session revocation, open-drawer guards, current-admin/current-terminal protection, recovery fencing, private-table denial, immutable records, credential-free audit, pagination beyond 50 staff, and unchanged student/card/PIN/wallet state.

`administration-browser.mjs` verifies the form and directories at four widths, committed-but-lost response recovery after reload, confirmed-change directory-outage behavior, and corrupt-storage write blocking. Full repository validation remains required before merging. Exact run IDs and pass/fail outcomes belong in the delivery record; this source document is not a premature certification.

## Release gates still separate

Do not use this feature as a workaround for the previously blocked demo cleanup. No live named staff credentials, terminal changes, migrations or activation are performed by this implementation. The school must approve real staff identities and roles, private credential handover, actual terminals, opening inventory, demo remediation, production configuration and physical acceptance. Cash-funded wallet deposits, cash drops/transfers, complete accounting history/export and store-location/ordering administration retain their separate launch requirements until delivered and verified.
