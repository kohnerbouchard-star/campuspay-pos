# Complete wallet and cash-close history

This delivers the wallet-history and cash-close-history portion of production roadmap Phase 2. It is not full sales/inventory/order/audit reporting, the daily reconciliation workspace, or production certification.

## Operator workflows

Accounting → Student wallets → View history now opens the complete ledger in 50-row pages, replacing the old most-recent-100 display. Staff can search reference, reason, entry type, operator or notes; select both Korea dates (up to 366 inclusive days); or view all history. The selected-range net amount and row count cover all matching records, not just the displayed page. The current wallet balance and all-time ledger difference are explicitly distinguished from the selected period. An empty filter result does not imply that the original balance was zero.

Cash register → Search or export complete cash-close history opens `/cash/history`. This supports all-history or Korea closing-date filters, reference/terminal/operator/note searches, full-filter totals, pagination, and detailed close calculations including funding/manual cash movements. Accountants and Super Admin see all terminals; cashiers remain restricted to their current terminal. Inventory-only staff have no cash-history access. Dates select when a drawer was closed, not when its individual transactions occurred, so the screen is not advertised as a daily sales statement.

Both screens export every matching record from one database-statement snapshot, irrespective of the displayed page. CSV includes stable identifiers and original recorded balances/amounts. A result larger than 50,000 rows returns an explicit error requiring a narrower filter; it never silently returns only a page. Text cells are quoted and spreadsheet-formula prefixes neutralized. Numerical negative amounts remain numeric. Exports require authenticated role checks and use `private, no-store` responses.

Navigation is live, rather than a persistent frozen snapshot across requests. An export is the single-snapshot source for an accounting record. Previously exported data should be reconciled against its selected period and retained under the school's approved retention policy.

## Compatibility and data boundaries

New forward-only migration/schema pair 038 adds two narrow reporting RPCs. It does not edit balances, funds, receipts, cash events, credentials or past migrations. Ordinary session authorization may update session activity.

The old two-argument wallet-history RPC and `/transactions` endpoint are retained for older deployed clients; they still have their historical 100-record bound. The current wallet-history UI no longer calls them. Do not use that legacy endpoint for complete-history exports. Current-page cash CSV remains separately labelled, alongside the new complete-history path.

Existing unjournaled/demo opening balances are surfaced as a discrepancy, never fabricated into transactions or hidden as zero. Live cleanup, migration, activation, retention approval and physical acceptance remain separate work.

## Focused acceptance

`verify-history.mjs` uses the existing CI-only localhost disposable harness. It creates 101 wallet entries through the authenticated adjustment API before controlled-funding adoption, then reads 50/50/1 pages and a complete export. It creates 52 legitimate zero-float drawer closes through cash APIs to verify cross-page exports and cashier terminal boundaries. No financial fixture is inserted directly into a journal. Read/report/export checks compare wallet/ledger/close digests to prove those records were unchanged by the reads.

Browser acceptance exercises the last wallet and cash-close page and four responsive widths. Existing settlement, funding, refund, scanner and integration suites remain enabled. Exact run IDs and final results are recorded in the PR/tracker after execution, not inferred from this source document.
