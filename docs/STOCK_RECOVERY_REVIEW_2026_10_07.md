# Stock-removal recovery — independent review brief

This draft fixes a reproduced repeat-removal path: after the database committed a removal but its response was lost, Cancel → edit → confirm generated a new key and removed another unit. It does not approve a production cutover.

## Scope and ownership

Base: PR #42 `4e55ece88cb0afcc3e85c8f0436f8d346f5c40a1`, unchanged. Branch: `fix/stock-removal-recovery-20261007`. PRs #33 (`e9882794e679964b119af9455aae055de6edbc4e`) and #34 (`fe5eb6783e3e9878b9e8a50825e9d8d098f4f948`) remain separate. Only their stock-specific closure/binding/storage patterns were adapted. Their credential, readiness, receipt, transport and shared-workflow changes were not imported. Current permissions and API transport are reused.

The five `20261005*` access/funding migrations and their qualification reference are byte-identical. This draft adds only `20261007120000_stock_adjustment_recovery.sql` and its identical `050_stock_adjustment_recovery.sql` schema mirror. The new migration is not included in the frozen cutover package. Migration remains paused for the user's Mac preparation; no hosted migration, deployment, maintenance, credential or feature-setting change is authorized by this draft.

## Contract to review

- The browser stores only a versioned opaque UUID, scoped by operator, before sending a request. Web Locks serialize publication across tabs. Missing/corrupt storage or unavailable locking blocks new submission. A snapshot of the validated input is captured before asynchronous work and is never reconstructed from an edited draft.
- Unknown results retain the reference and block new submission. Navigation, selected-product remount, reload and reauthentication preserve the reference. Another tab clearing storage is not treated as proof that an in-memory pending operation completed. Stale completion cannot clear a different pending reference. Storage clearing failure also remains unresolved.
- Stock-only success/recovery schemas require an exact request reference, valid receipt identity and timestamp, and explicit `POSTED` or `CLOSED` recovery state. A malformed response, wrong key, timeout or denied recovery never unlocks a new removal. The stock server wrapper canonicalizes the driver's SQL timestamp to ISO; shared API transport is unchanged. Normal and recovery requests have a 20-second browser deadline and never automatically repeat a mutation.
- Both API routes require `inventory.adjust`, authenticated staff origin and strict JSON input. The database independently requires the current capability. Execution and recovery share one transaction advisory-lock namespace/key.
- Replay must match the original operator, terminal and normalized complete payload. A new valid session for that same operator/terminal may recover the original result. Other operators/terminals and revoked capabilities are denied.
- Recovery either returns the committed adjustment or records an immutable closure that prevents any delayed original execution. Repeated closure returns the same state and records only one closure audit. A missing row by itself is never interpreted as permission to submit a replacement.
- The existing costing function is moved to `private.remove_stock_costed` without changing its body. Runtime and PUBLIC execution of that private function are revoked. The wrapper calls it only after recovery fencing. Lot allocation, stock movements, cost accumulation and the original `STOCK_REMOVED` audit remain atomic. New closures have an immutable trigger, original operator/terminal foreign keys and an audit event.
- Runtime access is execute-only through the API functions; new private tables are not directly readable or writable. No stock, wallet, sales or audit history is rewritten by migration.

Opaque storage is a browser safety mechanism, not authorization. Deliberately clearing browser storage loses that browser's recovery reference; there is no new cross-device pending-operation directory in this bounded change. Operators must investigate an unknown removal rather than infer that a missing local reference means nothing posted. Database same-key guarantees and original operator/terminal enforcement remain authoritative.

## Validation and evidence

`scripts/stock-recovery-upgrade.mjs` rehearses the frozen baseline → new migration on disposable localhost PostgreSQL. It seeds a pre-upgrade removal, compares complete existing stock/movement/audit/lot/wallet/sales rows before and after migration, verifies the preserved costing body, checks transaction rollback of the migration, and recovers/replays the pre-upgrade operation under a new session without changing history.

`scripts/verify-stock-recovery.mjs` runs native HTTP/database and pinned Playwright Chromium checks:

1. Authentication, effective capability, origin and strict input denial.
2. Exact/altered replay, cross-operator and cross-terminal denial, original-terminal reauthentication.
3. Immutable audited closure, delayed-execution fencing and runtime/PUBLIC grant checks.
4. Audited permission revocation/restoration with denied recovery while revoked.
5. Three controlled independent-connection overlaps: execution before recovery, closure before delayed execution, concurrent same-key executions.
6. Multi-lot exact costing and a forced late audit failure with transaction rollback.
7. Desktop 1440px and mobile 390px Cancel/Escape before mutation, committed-response-loss, navigation/product remount/reload/reauthentication, denied and mismatched recovery, and one native removal.
8. Committed HTML/malformed/wrong-key responses and storage-clear failures with no replacement POST.
9. Corrupt/read/write storage failures and unavailable cross-tab locks.
10. Real simultaneous browser tabs producing one POST; recovery closes the stalled original before its late arrival.

Results, upgrade evidence, native adjustment/movement/cost/audit counts and seven screenshots are written to `.validation/stock-recovery/`. Screenshots contain synthetic fixtures only. The two unit files cover durable storage/coordination and strict response evidence. Existing effective-access and financial regression gates remain enabled.

The branch-owned workflow checks the exact PR head and same-repository/branch identity, uses localhost-only disposable databases, and retains all existing core/security/access/five regression groups plus the stock group. It never deploys. `vercel.json` disables automatic Git deployment for this exact branch only before publication.

## Qualification limits

Independent review is requested, not claimed complete. Exact-head CI status belongs in the PR evidence, not an earlier local pass. The baseline dependency lock remains unchanged; PR #47 owns its security repair. Do not hide the baseline dependency audit failures or artifact-quota failures. Missing CI artifacts are not retroactively supplied by local screenshots. Integration with other draft PRs, retained integrated CI evidence and an independently reviewed expanded cutover remain separate work.
