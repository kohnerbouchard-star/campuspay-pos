# Pre-merge operational remediation — 8 September 2026

This pass continues the existing modernization on `feat/campuspay-ui-ux-refresh`.
It makes the register usable during normal school operations, moves split tender
planning after card identification, bounds event cash, and explains an older
database deliberately. Atomic settlement, immutable journals, wallet limits,
authorization, and same-request recovery remain intact.

## Delivery record

| Requested field | Result |
| --- | --- |
| 1. Starting SHA | `dc6fe80d320bfec95a2e5cb3974ffcb5b6f8295c`; fetched `origin/main` remained `18aace8950820163974e6b1199db45bb16ae40ad`. |
| 2. Ending SHA | Supplied in the final handoff and the PR head; not embedded in its own commit. |
| 3. Files changed | [Complete remediation file inventory](UI_UX_REMEDIATION_FILES.txt). The original generated `next-env.d.ts` dev references are preserved and excluded from commits. |
| 4. POS timeout | Named five-minute default, final 30-second warning, focusable **Stay signed in**; pointer, keyboard, and touch reset the timer. |
| 5. Payment lock behavior | Bounded protection covers card, PIN, cash, split, confirmation, recovery, and immediate receipt review. Completion/cancellation resumes a full idle window. A five-second heartbeat preserves an active workstation under the existing server session policy. Server expiry/revocation still forces sign-in. |
| 6. Split redesign | Cart → Split → card → identity/capacity → maximum or manual wallet amount → cash/PIN review → one settlement. No pre-scan amount is required. |
| 7. Wallet capacity | Server returns the configured floor and `min(total, max(0, balance − floor))`; currently floor −₩15,000. Manual split is positive, below total, and within capacity. Full coverage offers a real wallet-only switch. Settlement rechecks the live wallet. |
| 8. Cash expiry | Required named event with future end within 24 hours; PostgreSQL `timestamptz`, local browser display. Creation, confirmation, and tender posting enforce expiry. Audits retain actor, previous/new configuration and deadlines; expiry status derives from that audited deadline without a background write. |
| 9. Settings | `/settings/payments` is the sole full management UI. POS has current status/event/end time and a Super Admin shortcut. Cash/Split disappear and new cart selection returns to MICA Money at expiry. |
| 10. Compatibility | Fixed RPC registry classifies only known missing required functions/columns/relations/schema as safe HTTP 503 `DATABASE_UPGRADE_REQUIRED`. The versioned policy RPC acts as the small capability boundary. POS displays **Database update required**, explanation, and retry. No SQL, host, credential, signature, or migration history is returned. Unrelated failures remain generic 500. |
| 11. Favicon | `src/app/icon.svg` supplies a high-contrast MICA M mark through App Router metadata; legacy `/favicon.ico` redirects to it. Verified in development. React DevTools recommendations remain normal. |
| 12. Customer checkout | Before quote: **Estimated after purchase**, with an informational floor warning that does not block review. After quote: **After purchase** with server amounts. An unselected required room is explained visibly; West floors remain visible/unavailable. Known failures and unknown results use distinct copy and styling across POS, orders, enrollment, adjustments, and stock receipts. |
| 13. Commands run | `npm run validate:static`, `npm run typecheck`, `npm test`, `npm run lint`, `npm run build`, `npm run test:integration:isolated`, `npm run test:visual`; pinned Neon rollback script; `node scripts/dev-browser-check.mjs`. |
| 14. Test counts/results | Baseline: 80 tests/14 files plus static/type/lint passed before edits. Remediation: 114 tests/16 files, 39 local HTTP coverage groups, old-schema check, and all static/type/lint/build checks pass. |
| 15. Browser QA | 212 captures / 56 states at four widths: 1440, 1024, 768, 390px; 41 selected images retained. [Evidence and results](visual-qa/README.md) cover the new flows, real event expiry, warning interaction, lost receipt recovery, old capability UI, and development icon. Screenshots were visually reviewed; no unexpected console/page errors or document overflow. |
| 16. Neon QA | Existing `dev-ui-ux-refresh-20260907` / `br-late-bread-azrpu2xh`, confirmed non-default/non-production. Only pending migration `20260908090000_register_remediation` applied there. Six checks passed; all synthetic transaction fixtures rolled back and verified absent. |
| 17. PR | Requested base `main`, head `feat/campuspay-ui-ux-refresh`; PR number/link provided in final handoff. No merge. |
| 18. GitHub CI | Final handoff reports the actual Actions result and run link for the pushed head. CI runs on the PR and uses disposable PostgreSQL, including the actual old-schema check and browser suite. No deployment command is part of this validation workflow. |
| 19. Remaining limits | Two-minute server payment intents remain authoritative; this pass does not extend their life. Background browser throttling/network loss can expire server sessions. Recovery records remain scoped to the tab; closing/clearing it requires consulting authoritative history. Full drawer reconciliation, multi-wallet splits, historical pagination, and formal whole-site accessibility certification remain deferred. |
| 20. Human acceptance | Physical MICA Money Card scanning, real E202 enrollment/handover, cash counting and change-giving, and actual school register operation still require human acceptance. Automated tests alone do not establish production readiness. |

## Security and transaction decision

The existing payment intent was extended instead of adding another card lookup or
financial operation. A Split draft has an explicitly null wallet allocation. The
existing scan binds one active card to the same session’s unexpired intent and
returns only safe identity/wallet amounts. `finalize_payment_tender` binds the plan
once after checking current capacity and terminal policy. Identical retries return
the same plan; changing the amount requires cancelling and restarting. This
preparation performs no PIN verification and no money, stock, revenue, COGS, or
coupon mutation. No raw card data is stored by the new operation. Existing PIN
attempt limits and session/terminal authorization remain in force.

The original confirmation transaction still locks and revalidates wallet, card,
credentials, coupon, prices, stock, and terminal policy. It posts exactly one sale,
its tender legs, only the wallet portion of the ledger, inventory movement, COGS,
and coupon redemption together. Deferred reconciliation remains unchanged. Late
injected database failure and insufficient cash both leave every financial and
inventory journal unchanged. A lost successful receipt response is recovered by
the original intent, with no second wallet debit or sale.

The workstation lease is bounded by the intent deadline plus 30 seconds of result
handling, or 60 seconds for a newly displayed receipt/initial recovery. Expired
proposals cannot settle and show cancellation guidance. Normal inactivity resumes
when the lease ends or the workflow completes. Heartbeats never renew already
expired or revoked server sessions. No server session timeout function was changed.

## Verification coverage

- `inactivity.test.ts`: default/warning boundaries, activity reset, bounded active
  workflow, processing/recovery protection, completion/cancellation, and expiry
  classification. Browser virtual time also checks the actual warning button and
  pointer/keyboard/touch handlers.
- `tender.test.ts`: card-first draft, manual/max boundaries, zero/full-total split
  rejection, exact remainder/change, insufficient cash, and event input window.
- `remediation-integration.mjs`: same-session/card binding, draft confirmation
  rejection, server capacity, immutable plan replay, wallet switch, no preparation
  writes, named/audited expiry, stale cash/split rejection, wallet availability,
  missing RPC mapping, and expired server heartbeat/checkout rejection.
- `old-schema-check.mjs`: creates a second disposable database containing only the
  four migrations through `20260906160000_online_store`. Staff login and catalog
  succeed; the absent refresh capability returns the exact safe 503 response.
- Existing tender integration retains atomic rollback, PIN/coupon/wallet/stock
  failures, concurrent duplicate settlement, immutable journals, change/revenue,
  original-terminal recovery, and stock-receipt replay tests.
- Browser matrix verifies actual database-backed workflows. A deliberate receipt
  response loss exercises the amber unknown-result state and same-intent recovery.
  The development-only browser check sends no credentials or mutations.

## UI/UX refresh local development

Use a database branch with migrations **20260907090000 and later**, including
**20260908090000_register_remediation**. **Do not point this feature branch at
production before the production migration has been approved.**

The current QA target is `dev-ui-ux-refresh-20260907`
(`br-late-bread-azrpu2xh`); branch names may change. Use the restricted runtime
connection for the application, preserving application secrets. Select a QA owner
connection separately and explicitly only for approved QA migrations. Connection
URLs are never documentation or source-control content.

The running development process at handoff uses the QA runtime connection via
process-only environment overrides; `.env.local` was not replaced. Temporary
credential files are removed after launch/verification. Restarting with plain
`npm run dev` will again use your saved configuration, so explicitly select the
matching QA connection for future sessions. The generated `next-env.d.ts` dev
imports remain a local user change.

No production migration, manual production Neon modification, merge, or deployment
was performed. Production promotion remains a separate approved task after CI and
school operator acceptance.
