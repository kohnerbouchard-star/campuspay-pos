# Authorization security review

The database resolves effective permissions from an explicit `private.staff_access` snapshot. Presets seed creation/reset defaults; role names and frontend metadata do not grant ordinary authority. Unknown capabilities, duplicates and missing prerequisites are rejected. Only intentional Super Admin access assignment and Super Admin creation retain role/preset invariants in addition to explicit capabilities. Session role snapshots remain as stale-session checks and timeout metadata.

Navigation filters workspaces and sections. Server pages deny before protected data fetches. API routes authorize before domain work; domain services check operation-specific capabilities; security-definer database functions repeat the relevant checks. Runtime table/function grants continue to prohibit direct private-table writes and bootstrap. MICA Store retains separate cookies, origins and customer-session RPCs.

## Sensitive operations

| Boundary | Enforcement |
| --- | --- |
| Employee access | Active Super Admin, explicit `staff.access.manage`, current PIN, target/revision, old and new snapshots, reason, confirmation, immutable event and audit reference |
| Stale or reduced access | All target sessions revoked; revision checked on authorization and RPC session assertion; next sign-in returns stored capabilities |
| Self/final administrator | Self access changes forbidden; another authorized Super Admin required. Final usable access administrator and final active Super Admin protections retained |
| Staff credentials/profile | Explicit staff capability and fresh actor PIN; ordinary staff manager cannot take over a Super Admin; profile editor cannot change roles |
| Terminal/payment settings | Independent terminal/payment capabilities; current-terminal and open-drawer restrictions preserved |
| Wallet funding | Separate fund/correct/reverse capabilities; selected-student identity binding; card/PIN, cash drawer, source/reason, gates, immutable receipt/ledger/journal and recovery retained |
| Wallet correction/reversal | Different current employee with `wallet.approve`; exact original receipt and once-only reversal; wallet floor and operator/register binding retained |
| Credential change | Separate initial issue/reset/card replacement; independent `credentials.approve`, expiring one-use elevation; approval checked again when consumed; reset cannot issue first PIN |
| Cash movement/variance | Independent specific approval capability; initiator/reviewer inequality in database, current cash controls and ownership gates preserved |
| Refund | Read/issue/cash handover separated; issue no longer authorized by sales-report permission. Existing verified tender-linked single-operator policy retained; no unimplemented approval feature is advertised |
| Stock removal | Explicit inventory adjustment permission, reason, lot/quantity/immutable movement safeguards retained. Formal stocktake/variance approval and unknown-result removal recovery are still open |

Native database tests exercise A initiating, A self-approving denied, unassigned C denied, assigned B permitted for installed wallet corrections/reversals, credential resets, cash movements and variance reviews. Existing browser/API suites retain cash, refund, payment, student lifecycle, receipt, security recovery, administration lock-order and customer/staff isolation assertions.

## Migration review

`legacy-mapping.json` is the exact semantic backfill. Existing employees keep their prior operating domains; they do not receive the new broader Manager defaults. Split view prerequisites support the existing financial, order and credential lookup workflows. Inventory staff do not gain wallet data; accountants do not gain refund issuance, inventory mutation or staff administration. Generic new Staff does not inherit existing cashier cash/order authority. Corrections and credential approvals now forbid self-approval even for Super Admin.

Old broad names remain only as historical contract/test metadata or retired RPC guards. No effective assignment includes `wallet.adjust`, `students.manage` or `security.*`. Legacy wallet posting cannot be reactivated by a UI fallback; historical receipt recovery remains guarded.

`authorization-locations.txt`, `routes.json`, and `database-boundaries.json` record baseline checks. `current-routes.json` and `current-database-boundaries.json` record installed candidate checks. Counted migration edits abort on unexpected function bodies instead of silently dropping transaction logic.

## Limits

The complete development audit retains the existing exact, expiring braces advisory policy; no dependency exception was broadened. Runtime dependency audit remains a separate passing gate. Native CI and synthetic backup restore do not prove physical hardware, production configuration, production monitoring or a production backup. Release remains blocked until the exact project/database cutover is accessible and validated.
