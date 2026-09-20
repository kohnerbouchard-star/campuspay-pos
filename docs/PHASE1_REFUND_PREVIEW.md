# Phase 1.1 — Original-sale allocation and item-level preview

Parent: [production plan, Phase 1.1](PRODUCTION_COMPLETION_PLAN.md#11-partial-refunds-and-partial-returns). Execution issue: #15; master tracker: #4.

## Delivered scope and boundary

This first implementation slice adds an item-level calculator to the existing refunds workspace and a narrowly authorized PostgreSQL preview API. It is **not partial-refund posting**, and does not complete Phase 1.1. Existing full-sale refund/return posting, immutable journals, one-refund-per-sale constraints, request proofs and recovery are unchanged. No production migration or activation is performed by this code delivery.

The application gate `PARTIAL_REFUND_PREVIEW_ENABLED` and database `partial_refund_preview_enabled` both default off. The calculator can be separately enabled in an isolated development/rehearsal environment even while financial posting is disabled. Accountants and Super Admin have the same financial-report access used by receipt lookup. Students, cashiers and inventory-only staff cannot query the calculator. The runtime cannot directly call private calculation helpers or read financial tables.

The UI always says estimate only; `preview_only=true` and `posting_available=false` are validated response literals. No quote is a reservation, a posting authorization or evidence that money was refunded. A network failure can safely retry calculation without a mutation recovery key. Changing selected quantities clears an earlier estimate.

## Calculation contract: PARTIAL_REFUND_ALLOCATION_1

These are explicit implementation choices for rehearsal, not a claim of school approval for live partial refunds. Approval belongs to the later activation gate.

For a total T apportioned across P parts, the value for N parts beginning after B prior parts is:

`share(T,P,B,N) = div(T*(B+N),P) - div(T*B,P)`

All operands are nonnegative integers, P is positive and B+N cannot exceed P. Multiplication and addition use PostgreSQL numeric, then exact integer quotient `div`; results are bigint whole won. No floating-point currency arithmetic is used. Adjacent slices telescope, so splitting a complete quantity cannot create or lose a won. Zero-price/fully-discounted amounts are handled without dividing by zero.

1. Allocate the original paid total, not today's catalog prices, across all original sale lines in stable sale-item UUID order, weighted by original gross line value. This allocates the original sale-level discount once. Selecting a subset never reallocates other lines' discount.
2. Allocate each line's net value across its original units. This first slice accepts only sales with **no prior refund**, so the cumulative starting quantity is zero. Current posting constraints are deliberately not relaxed.
3. Divide the selected net refund between original wallet and cash shares. Change already given is not part of the original settled cash tender. For future repeated partial posting, the starting value must be the cumulative refund amount, not zero on every operation.
4. Calculate original COGS using the original cost allocations in `(created_at, allocation UUID)` order. Restock quantities precede write-off quantities within the selected original units. Use cumulative slices of each allocation's stored total cost, never today's lot price or a newly rounded unit cost.
5. Expired original lots cannot be estimated as saleable restock. Damaged/unusable goods are represented by write-off quantity; damage reason and inspection evidence belong to the later posting command.
6. Preserve the existing `KEEP_REDEMPTION` coupon policy. No refund estimate restores a coupon allowance or rewrites redemption history.

The allocation order is an accounting estimate, **not physical lot identification**. The later posting workflow must capture/verify which original lots correspond to the inspected goods; it must not silently restock a different lot. A selected quantity greater than the original line quantity, a foreign sale line, malformed quantity, duplicate line or client-supplied monetary amount is rejected.

The planner validates original sale/subtotal/discount/tenders/line quantities/cost allocations before calculating. PostgreSQL STABLE is used for a coherent financial-data snapshot. The authorized wrapper performs the existing normal session/terminal activity bookkeeping; “non-posting” does not mean no session activity is recorded.

POS sales and dispatched/delivered online returns can be estimated. Pre-dispatch cancellation remains the existing full-sale operation. Any already-refunded sale fails closed rather than guessing remaining quantities from an incompatible history. Preview values may become stale immediately after calculation; posting must recompute under the appropriate locks, never trust the client estimate.

## Files and validation

- `database/schema/030_partial_refund_preview.sql` and exact migration pair `20260920120000_partial_refund_preview.sql`.
- `POST /api/refunds/preview`, feature domain/service and calculator component in `src/features/refunds`.
- Domain and route-authorization tests reject posting-like input and non-reconciling output.
- `scripts/refund-preview-math.mjs`: independent BigInt oracle and SQL slices, including max-bigint overflow intermediates, telescoping partitions and invalid arguments.
- `scripts/verify-refund-preview.mjs`: disposable CI-only localhost database, real HTTP routes, existing full-refund race, original-price and original-cost tests, role/feature gates, and financial/roster/audit table digests proving preview requests do not change them.
- `scripts/refund-preview-browser.mjs`: 1440/1024/768/390px calculator, quantity validation, stale-estimate clearing and failed-request retry.
- The new suite runs **in addition to** all previous validation, enrollment/refund/cash/admin/hardening and integration/browser checks.

Exact commit and completed CI results are recorded in the PR/issue; this document does not certify an unrun test or live release.

## Remaining Phase 1.1 work — required, not V2

The next implementation must introduce forward-only cumulative partial journals and caps without changing historical records, preserve old full-refund replay proofs, and recompute allocation under one consistent lock order. It must handle multiple operations and zero-net units, exact remaining quantities and tender balances, original-lot inspection, wallet credit, separately observed cash payout, idempotency/recovery fencing, and partial/full/refund/cancellation races. Database reconciliation must enforce cumulative caps even when bypassing the UI.

Reports and customer-facing order/return history must distinguish partial from full reversal and must not mark an entire order RETURNED while unreturned goods remain. The original full-sale path must fail safely when partial history exists. Staging rehearsal, rounding/coupon/inspection policy approval, production migration and physical acceptance remain required before final certification. Do not close #15 when only this calculator is delivered.

## Technical references

- PostgreSQL 17 numeric types: https://www.postgresql.org/docs/17/datatype-numeric.html
- PostgreSQL 17 mathematical functions (`div`): https://www.postgresql.org/docs/17/functions-math.html
- PostgreSQL 17 function volatility and snapshots: https://www.postgresql.org/docs/17/xfunc-volatility.html
