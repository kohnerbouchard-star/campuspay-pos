# Returns and cash-register operating controls

## Implemented scope

This change completes full-sale post-dispatch returns and a first operational cash-drawer cycle. It does not issue live student cards, activate refund posting, clean demo data, or claim a production launch.

An online return requires Super Admin authorization, the original receipt, in-person inspection of all returned goods, a reason (failed delivery or customer return), and a disposition for every original line. The new RETURNED terminal state is not a rewritten cancellation. The prior delivery timestamp and all original financial journals remain unchanged. Original wallet/cash allocation, original-cost restock/write-off, unchanged coupon-redemption policy, idempotency, and response-loss recovery use the same checked reversal engine. A failed-delivery return is only accepted from OUT_FOR_DELIVERY; a completed delivery requires customer-return classification. Missing or lost goods that cannot be inspected are not silently treated as returned stock.

The UI displays the return action only for dispatched/delivered online orders and only with RETURNS_ENABLED=true. The database separately requires returns_enabled and refunds_enabled; REFUNDS_ENABLED is also required. All default off. The original pre-dispatch API remains backward-compatible, including its request-proof format. A returned/cancelled student timeline no longer displays future delivery steps.

Cash controls require CASH_CONTROLS_ENABLED=true and cash_controls_enabled=true to open a drawer. Closing an already-open shift, recovering an operation and independent variance review remain available during an application posting shutdown. Changing the database attribution setting while any shift is open is rejected.

Each terminal has at most one open shift. The cashier counts the opening float using supported won denominations. A trigger attributes settled CASH tenders (excluding change) and observed refund payout records to that shift in the same transaction. An enabled drawer control refuses cash settlement/payout without an open shift. A close and a cash settlement lock the same shift: a committed sale is either included in the frozen closing total or rejected if the shift closed first. The immutable close contains the actual count, expected cash, over/short variance and explanation. A second accountant or Super Admin may approve the documented variance; the closer cannot self-approve and approval never alters the original count.

Expected cash = opening float + settled cash checkout tenders - recorded cash refund payouts. This register does not yet include cash-funded wallet deposits, cash drops, transfers between drawers, or arbitrary paid-in/out transactions. Do not process those physical movements through an unrecorded workaround. Opening and closing are not instructions to move or dispense money.

Browser recovery stores only an operation type and opaque request/shift UUIDs. Recovery returns the committed result or closes a missing operation so a delayed request cannot mutate the drawer afterward. Original operator and terminal bindings remain enforced. Closed-shift history is paginated in 50-row pages; Export this page is explicitly scoped to displayed rows, not advertised as an all-history export.

## Verification

Additive schema/migration pairs: 025 return_status; 026 online_returns; 027 cash_shifts. Enum additions commit before functions reference RETURNED. No real students, secrets, demo purge, production top-ups or live payment tests are embedded.

New domain tests validate denominations, bounded amounts, acknowledgments, return schema compatibility, opaque recovery and terminal timelines. scripts/verify-operations.mjs uses a uniquely named disposable local PostgreSQL database and actual HTTP routes. It covers default-off flags, permissions, original-tender returns, race/replay behavior, post-dispatch transitions, drawer attribution, cash/split/change, exact and discrepant closes, independent approval, recovery closure fencing, private-table denial and repeated checkout/close races. Browser checks cover count forms, committed-but-lost opening response recovery, inspected-return submission and responsive layouts. The original full validation remains enabled.

## Remaining release requirements

Do not represent the entire v1.0 plan as complete from this change. Demo cleanup remains blocked and unresolved. Real staff/terminal lifecycle administration, real product/stock setup, expanded cash-funded wallet/deposit controls, full reporting/history export, order-open/cutoff/location administration, monitored hosting and restoration, and physical reader/E202/cash-handling acceptance remain separate requirements. Live activation is not automatic and the 135-student roster must remain unissued until separately instructed.

Use docs/V1_LAUNCH_PLAN.md for the broader acceptance gates. Exact commit/test run evidence belongs in the PR completion record, not a premature statement in source documentation.
