# Phase 1.1 — Cumulative item refunds and returns

Parent: `PRODUCTION_COMPLETION_PLAN.md`, issue #15 and master #4. This is the actual posting implementation after preview #16. Implementation does not itself certify production migration, policy approval or physical cash handover.

## Operator workflow

Refunds → Item refunds and returns: find the original receipt, identify physically inspected original stock lots, and select saleable and write-off quantities. Review original discounted value, wallet/cash allocation and cost. A Super Admin confirms identity, original goods, reason and notes before posting. Accountants can inspect and calculate but cannot post. Missing goods are not treated as inspected stock.

Posting recalculates under sale/order and affected financial locks. A changed refund count rejects a stale review. Each operation gets an immutable receipt; repeated partial refunds cannot exceed original quantities, settled amounts, original tenders or allocated costs. Wallet credit, refund tender records, stock movements and audit commit in one transaction. Cash is never dispensed automatically: its actual handover is recorded separately against the particular refund receipt, original operator and terminal.

## Allocation contract

`PARTIAL_REFUND_LOT_1` apportions original discounts in stable sale-line UUID order, then consumes each selected line's cumulative unit-value slice. Original settled wallet/cash shares exclude change. Original allocation IDs are explicitly selected; costs use stored original allocation totals rather than current purchase costs. Saleable units precede write-off units within an operation. Quantities and whole-won amounts telescope across repeated selections. Zero-net units consume return quantities/costs without zero-value wallet entries. Expired stock cannot be restocked. Coupon policy remains `KEEP_REDEMPTION`.

## Compatibility and integrity

Forward-only schema/migration pairs 031–033 introduce partial scope, immutable per-operation contexts/items and deferred cumulative constraints. Previously published migrations and original full-refund records/replay proofs remain unchanged. New full-sale posting refuses a sale with partial history; the final remaining units must use item-refund posting. Original full-refund retries retain their receipts.

Deferred checks cover amount/quantity/tender/cost caps, original allocation attribution, cumulative counters, inspected selections, wallet/stock journal links and online inspection. Private tables/helpers are not directly accessible to the application runtime.

Each receipt is addressable by refund ID. Sale refund history is paginated; the existing latest-refund contract is retained for old screens. Existing net-day reporting and drawer attribution use the shared refund journals rather than a parallel accounting system.

## Online behavior

Item returns apply after dispatch/delivery. Pre-dispatch cancellation remains full-sale cancellation. Partial returns preserve delivery state; only returning all original units marks the whole order RETURNED. Student order history is own-order-only and excludes operator identities, staff notes, stock-lot identifiers and internal costs.

## Recovery and activation

`PARTIAL_REFUNDS_ENABLED` plus the existing refund gate are required in the application, and `partial_refunds_enabled` plus `refunds_enabled` in the database. Online returns also require return gates. New posting defaults off. Authorized receipt lookup and recovery remain available during posting shutdown. Browser recovery stores only opaque sale/request identifiers. A missing request can be closed so delayed submission cannot post afterward. Corrupt/unavailable recovery storage blocks new posting.

## Verification and safety revision

The revised integration harness uses the existing CI-only, localhost-only disposable database. It exercises actual HTTP posting for wallet/cash/split partial refunds, one-won rounding, mixed dispositions, duplicate and altered replay, stale selections, over-quantity no-effect rejection, full/partial incompatibility, separately addressed cash payouts, cancellation eligibility, online return completion, customer projection privacy, independent-connection concurrency and browser response-loss recovery. Read-only PostgreSQL catalog queries confirm enabled immutable and deferred guards; aggregate queries reconcile posted refunds and cash events.

The earlier unpublished harness's journal deletion attempts, temporary audit-trigger replacement and fabricated direct refund rows have been removed. No application protection was removed or disabled. Deliberately injected audit-trigger failure, the prior 51-refund stress case and the earlier direct-owner malformed-journal experiments are not claimed as executed coverage of this revised harness. Existing preview arithmetic and original application suites remain enabled.

Exact candidate/main workflow results must be recorded separately. This document is not a claim that pending verification passed. Owner-approved policy, live migrations/activation, hardware acceptance and the rest of Phase 1 remain open.
