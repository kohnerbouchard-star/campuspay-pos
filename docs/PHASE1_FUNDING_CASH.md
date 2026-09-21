# Wallet funding and physical cash movements

This is actual posting code for production roadmap 1.2–1.4 and the funding-journal portion of Phase 2. It is not another calculator. It does not close the entire production roadmap or authorize live financial activity.

## Operating contract

`/funding` provides cash wallet deposits, approved non-cash credits, approved deductions, full reversal of an original funding receipt, cash paid in, cash paid out, and cash drops to a named safe/bank reference. All operations use the existing wallet ledger and cash-shift event journal, not separate balances. There is no external payment processor, bank transfer API, automatic cash dispenser, or offline financial settlement.

A cashier can record only physical cash movements on their terminal. An accountant or Super Admin can operate the funding desk and student wallet workflows. A funding accountant can open/count/close their own drawer without acquiring POS checkout permission. All wallet operations retain card-first and private student-PIN verification. The approved logical wallet denominations remain ₩1,000/5,000/10,000/20,000/50,000, at most 30 selections, and the existing −₩15,000 floor remains enforced.

Cash deposits require an open bound drawer and separate received/change amounts. A ₩10,000 deposit paid with ₩20,000 records ₩10,000 in both the wallet and drawer; the ₩10,000 change is shown separately and never counted as retained cash. Amounts are frozen in a prepared request, not supplied again by the confirmation client.

Every non-cash wallet correction and original-receipt reversal requires a different active Super Admin's PIN approval. Each manual cash movement requires a different accountant or Super Admin. These are conservative implementation defaults for operational approval before activation; no guessed threshold grants unilateral high-value corrections. Source/recipient reference, meaningful reason, operator, terminal, approval and an explicit physical/identity acknowledgment are recorded. Student and approver PINs are never stored in the request, receipt, audit or browser recovery data.

A reversal points to the exact original cash deposit, non-cash credit or administrative deduction. Only one whole reversal is allowed per original operation. It affects the original wallet, uses the opposite original wallet/cash deltas, and requires that student's card/PIN. A cash-deposit reversal records the observed physical cash handback. It is not a sale refund. Requests below the wallet floor or beyond recorded drawer funds fail without a ledger or cash effect. There is no forced balance edit for absent students or spent deposits.

## Settlement and failure behavior

Prepare → scan the student card when applicable → inspect identity/amount/source → privately verify student and independent approver PINs → record the observed operation. Requests expire after five minutes. Do not keep an unposted deposit after a definite rejection. Do not return money, create another deposit, or repeat a cash handback while the result is uncertain: recover first.

Preparation does not reserve wallet money or drawer capacity. Confirmation rechecks current wallet limits, the original active card/student, approvals, the originally bound open shift, and reversal eligibility. A different/new shift cannot silently receive a request prepared for a closed drawer.

The wallet ledger, balance, immutable funding receipt, cash event and audit commit in one transaction. Request keys serialize duplicate submissions. Independent keys attempting to reverse the same original receipt cannot both commit. Deferred constraints reconcile the funding receipt to the existing wallet/cash journals. Wrong PIN attempts commit lockout counters without committing a financial effect.

Browser recovery stores only the opaque request key before any request. Reload requires original-operator/original-terminal recovery. Recovery returns the committed receipt or closes the unposted request so delayed execution cannot apply afterward. Corrupt/unavailable storage blocks new submissions. Sensitive fields clear on submission. The receipt must remain confirmed even if the subsequent journal refresh fails.

## Cash close and history

Expected drawer cash now includes opening float + cash sales − refund payouts + funding/manual cash in − funding/manual cash out. Existing immutable close and independent variance review remain. Funding accountants can close and recover an existing drawer during posting shutdown.

Funding history is paginated in 50-row pages. Totals cover the complete selected Korea-date range, not the page. A CSV export takes a single database-statement snapshot of every matching funding receipt; more than 50,000 rows returns an explicit narrow-range error, not a partial file. Select no more than 366 inclusive days per query. CSV text is escaped and formula-prefixed source text is neutralized. Cashiers receive only cash-only records from their terminal, not student wallet information.

The journal displays current all-time wallet-to-ledger mismatch counts, selected-date closed-shift/event mismatches, unreviewed cash-count variances, and unclosed prepared funding requests with sample counts. Existing unexplained/demo opening balances are surfaced, never silently fixed. An unclosed prepared request is not evidence of settled money. These checks are not the complete sales/inventory/day-close reconciliation workspace required by Phase 2.

## Release and adoption

New forward-only schema/migration pairs are 035 funding ledger, 036 funding API and 037 funding reports. Existing migrations are unchanged. `FUNDING_ENABLED` and database `funding_enabled` both default false. Cash operations also require existing cash controls. Posting activation must be reviewed separately on the correct database and deployment.

On first database activation, `funding_required` latches true. The old unclassified `WALLET_ADJUSTMENT` posting path is then blocked permanently; turning the new posting switch off cannot reopen that bypass. Old receipts still recover. During incidents use the posting switch, not a downgrade that re-enables direct adjustments. This code performs no live activation, demo cleanup, real staff provisioning or student card/PIN issuance.

Direct drawer-to-drawer transfers are not supported by this delivery and must not be simulated with unrelated paid-out/in records. The roadmap makes transfers conditional on an actual school requirement; a two-terminal custody/acceptance design is needed before enabling them. Pending fees, external payments, product sales and supplier expenses must not be disguised as wallet funding.

## Verification boundary

The new focused acceptance script uses the existing CI-only, localhost-only disposable harness and authenticated APIs for financial fixtures. It covers funding gates/roles, cash+change, card/PIN failures, independent approvals, original-receipt reversal, wallet/drawer limits, idempotent recovery, page-complete history/CSV, posting shutdown, and final drawer reconciliation. It adds actual-browser deposit/reload recovery and corrupt-storage checks. All previous suites remain enabled. Exact-head and actual-main results belong in the PR record; this document does not claim an unrun test passed.
