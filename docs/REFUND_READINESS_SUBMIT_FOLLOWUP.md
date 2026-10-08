# Full-refund readiness submission follow-up

Base: PR51 integration merge `dacee1bf7a4f987d0aa4482d74a05511da5712b0`.

Full-sale refunds previously awaited cash readiness before the parent set its busy state. During that GET, the operator could edit the visible draft or revoke verification while the pending closure retained the earlier values. Partial refunds already held their own busy state.

The full-refund form now acquires a synchronous submission guard and disables its fieldset before checking readiness. It keeps the guard through the parent's posting promise. Failed readiness unlocks the unchanged draft; changing the selected sale unmounts and cancels the pending form. Existing idempotency and unknown-result recovery stay in the parent.

`scripts/verify-refund-readiness-submit.mjs` exercises the real browser and API against disposable localhost PostgreSQL. It holds a readiness response, attempts notes/disposition/verification edits, dispatches a duplicate submit, releases a failure, verifies editable retry, cancels through another sale lookup, and recovers a committed-but-lost refund response with one POST and one refund row. The audit-fix CI includes this focused regression and remains limited to authorized same-repository branches.

No SQL, dependency, exception, or migration changes. The follow-up branch and integration destination both retain deployment holds. No merge, deployment, migration application or reopening is authorized by this change; independent review continues.
