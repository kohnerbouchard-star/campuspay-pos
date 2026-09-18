'use client'
import { useState } from 'react'
import { apiFetch } from '@/lib/api/client'
import { formatWon } from '@/lib/format/currency'
import { businessDate } from '@/lib/format/business-time'
import { RefundSummarySchema, type RefundSummary as Summary } from '../domain'
export function RefundSummary() {
  const [from, setFrom] = useState(businessDate())
  const [to, setTo] = useState(businessDate())
  const [summary, setSummary] = useState<Summary | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  return <section className="panel" aria-labelledby="refund-summary-heading"><h2 id="refund-summary-heading">Net reconciliation</h2>
    <p>Original sales, posted refunds, and cash handovers are grouped by their own Korea business dates. Totals include every matching record, not a truncated register.</p>
    <form className="toolbar" onSubmit={event => { event.preventDefault(); setBusy(true); setError(null); setSummary(null); void apiFetch<unknown>(`/api/refunds/summary?from=${from}&to=${to}`).then(value => setSummary(RefundSummarySchema.parse(value))).catch(() => setError('Reconciliation could not be loaded. Check the date range and installed migration.')).finally(() => setBusy(false)) }}>
      <label className="field"><span>Reconciliation from</span><input type="date" required value={from} onChange={event => setFrom(event.target.value)} max={to} /></label>
      <label className="field"><span>Reconciliation to</span><input type="date" required value={to} onChange={event => setTo(event.target.value)} min={from} /></label>
      <button className="secondary-action" disabled={busy}>Load reconciliation</button>
    </form>
    {error && <p role="alert">{error}</p>}
    {summary && <><p>{summary.sale_count} original sales; {summary.refund_count} refunds in this period. These counts are the observed sample, not a reliability claim.</p><dl className="detail-list">
      {([['Gross sales', summary.gross_sales_won], ['Refunds posted', summary.refunds_won], ['Net sales', summary.net_sales_won], ['Original sale COGS', summary.gross_cogs_won], ['COGS reversed', summary.cogs_reversed_won], ['Refund write-off losses', summary.write_off_cost_won], ['Net margin after write-offs', summary.net_margin_won], ['Cash payouts in period', summary.cash_paid_won], ['Cash liability at period end', summary.outstanding_cash_won]] as const).map(([label, amount]) => <div key={label}><dt>{label}</dt><dd>{formatWon(amount)}</dd></div>)}
    </dl><p className="muted">Cash liability includes earlier unpaid refunds as of the period end. A later refund or payout does not rewrite an earlier day. This is not a cash-drawer close.</p></>}
  </section>
}
