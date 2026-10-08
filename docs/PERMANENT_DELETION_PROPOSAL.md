# Proposed permanent deletion boundary — not implemented

The user requests actual deletion, not deactivation. Current main has no safe general hard-delete API; management validation rejects DELETE_PRODUCT/DELETE_STUDENT. Open PR41 implements recoverable hiding, retains identities and history, and is not a substitute. Do not merge it or relabel Archive as Delete to imply fulfillment.

## Proposed contract requiring scoped agreement before schema work

Introduce a distinct permanent-deletion capability, default only to Super Admin, rechecked in a narrowly granted SQL API. Deletion must also require the applicable entity-management permission, current administrator PIN, typed record code, reason, expected revision and an actor/terminal-bound idempotency key. Runtime gets EXECUTE only, never raw DELETE privileges.

Use a read-only eligibility endpoint returning named blockers and a short-lived review snapshot. The write must recheck eligibility, role, PIN and revision under locks in the same transaction as deletion; the preview is not authorization. Existing row-level FK locks/restrict constraints remain the final safeguard against concurrent checkout/enrollment/receiving/access changes. Establish consistent lock order before implementing and test races against each writer. Do not rely on a prior count query, disable constraints, or introduce cascading deletion of historical tables.

Persist a minimal non-sensitive audit/recovery tombstone outside the deleted identity's FK dependency, containing opaque original identity, entity type, actor, terminal, request key, outcome, reason and time. This is evidence of an actual deletion, not the active record itself. Replays return the original outcome after the entity is gone; a lost response must never cause a different deletion. Preserve earlier immutable audit events. Exact retention/anonymization policy requires owner decisions; do not assert legal compliance without one.

| Entity | Potential hard-delete eligibility | Must block or remain a separate proposal |
| --- | --- | --- |
| Product | Never stocked, sold, ordered, reserved or adjusted; no photo lifecycle/history dependencies. Initial catalog metadata/price rows need an explicit approved deletion rule. | Lots, movements, receipts, sale/order items, active reservations, photo operations/assets and historical references. Zero stock alone is insufficient. |
| Coupon | Never redeemed/reserved; no historical financial use. | Redemptions, sales, pending intents/orders and retained creation/recovery evidence. Expiry or deactivation alone is insufficient. |
| Student | Genuinely unused roster-only entry, with no wallet ledger, funding, order, sale, credentials/card issuance or enrollment completion history. | Enrolled students normally have wallet/card/credential/enrollment dependencies even with zero balance. Preserve those records; archive, or separately design policy-approved anonymization. |
| Staff | Never signed in or acted/approved/received/changed any historical record; not current user or required last active Super Admin. | Sessions, audit actors/approvers, sales, receipts, shifts, access-change history and creation/recovery references. Revoking a session does not erase its history. |
| Register | No session, shift, cash, sale, funding, refund or operation history; not current register. | Registers are usually created by sign-in, so many already have dependencies. No silent deletion of sessions/drawer history to make a register eligible. |

The first genuinely useful increment may therefore be unused catalog products/coupons and roster-only mistakes, not every inactive entity. Before implementation, agree whether to remove setup-only child metadata and whether identifiers may be reused. Safe default: historical identifiers remain reserved via minimal audit evidence; records with history use explicitly labelled Archive/Deactivate, with specific blockers and links to resolve open operational dependencies. Anonymization is a separate irreversible action, never an alias for deletion.

Confirmation should state exactly what will be erased, what minimal audit evidence remains, that it cannot be restored, and why linked records are ineligible. A disabled Delete control without actionable blockers is not acceptable. No live deletes or production migration/deployment is authorized by this proposal.

Required isolated tests: each eligible entity, each dependency blocker, least privilege/forged entity ID, current/last-admin safeguards, stale review, concurrent dependency insertion, repeated clicks/same-key replay, committed-but-lost response, cancellation before submit, invalid/expired PIN review, keyboard/mobile confirmation and zero unintended ledger changes. Additive migration needs separate review and a production rollout authorization.

## Concrete proposed API and migration increment

Names below are proposed, not existing endpoints or grants:

- `GET /api/management/deletion?kind=PRODUCT|COUPON|STUDENT&targetId=<uuid>` returns identity/version, `eligible`, stable blocker codes, and the setup-only records that would be removed. It reveals only entities the actor can already manage. Begin with these three useful entities; staff/register deletion remains deferred because their creation/sign-in normally establishes historical dependencies.
- `POST /api/management/deletion` accepts `{kind, targetId, expectedVersion, typedCode, reason, adminPin, requestKey, confirmed:true}`. Existing same-origin/session checks apply. It calls a narrowly granted transactional SQL function; the server never builds SQL identifiers from client input.
- `POST /api/management/deletion/recover` accepts only the original `requestKey`, checks actor/terminal ownership, and returns the tombstoned result. A missing operation must be closed under the same lock before returning “not deleted,” so a delayed original POST cannot delete afterward.
- An additive migration creates a private deletion-operation/tombstone table, an immutable audit event, a `records.delete_unused` capability defaulted only to Super Admin, and three owner-controlled functions for eligibility, execution and recovery. Reuse the project's session validation and idempotency conventions. Runtime receives function execution only. No existing journal FK or append-only trigger is weakened; no historical migration is edited.
- Execution locks the request and target, revalidates actor/session, expected version, confirmation, PIN and every dependency, then deletes only explicitly approved setup-only children and the unused parent. Validate the lock order against all insert/update paths in the implementation review; FK restriction remains mandatory even after the eligibility check.

Owner decisions needed before implementing: (1) whether unused products' initial prices/setup audit references and unused roster wallets may be removed; (2) whether coupon creation/recovery evidence is a blocker or retained separately; (3) whether deleted student codes/SKUs/coupon identifiers may ever be reused; (4) retention of the minimal tombstone and any later anonymization policy. Default proposal preserves identifier reservation and historical audit evidence. Allocate the next schema number/timestamp only after coordinating other work. No irreversible live action is part of this proposal.
