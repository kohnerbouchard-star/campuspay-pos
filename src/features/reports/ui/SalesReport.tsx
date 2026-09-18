'use client'
import Link from 'next/link'
import { BUSINESS_TIMEZONE } from '@/lib/format/business-time'
import { useEffect, useState } from 'react'
import { apiFetch } from '@/lib/api/client'
import { summarizeSales, type SalesRow } from '@/features/reports/summary'
import { Money } from '@/components/ui/Money'
import { ErrorState, LoadingState, EmptyState } from '@/components/ui/Feedback'

export function SalesReport({ compact = false }: { compact?: boolean }) {
  const today = new Date().toLocaleDateString('en-CA', { timeZone: BUSINESS_TIMEZONE })
  const [range, setRange] = useState({ from: today, to: today })
  const [applied, setApplied] = useState(range)
  const [revision, setRevision] = useState(0)
  const [rows, setRows] = useState<SalesRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let active = true
    apiFetch<SalesRow[]>(`/api/reports/sales?from=${applied.from}&to=${applied.to}`).then(data => {
      if (active) { setRows(data); setError(null) }
    }).catch((e: unknown) => { if (active) setError(e instanceof Error ? e.message : 'Sales could not be loaded.') })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [applied, revision])
  const totals = summarizeSales(rows)
  return <section className="sales-report span-two" aria-label="Sales and tender report">
    <form className="toolbar" onSubmit={event => { event.preventDefault(); setLoading(true); setApplied({ ...range }) }}>
      <div><p className="eyebrow">Revenue & settlement</p><h2>{compact ? 'Sales overview' : 'Sales report'}</h2><small>Dates and times in Korea Standard Time</small></div>
      <div className="action-row"><label className="field"><span>From</span><input required type="date" max={range.to} value={range.from} onChange={e => setRange({ ...range, from: e.target.value })} /></label><label className="field"><span>To</span><input required type="date" min={range.from} value={range.to} onChange={e => setRange({ ...range, to: e.target.value })} /></label><button className="secondary-action" disabled={loading}>Apply dates</button></div>
    </form>
    <p className="muted">These are original sale totals before refunds. <Link href="/refunds">Refunds and net reconciliation</Link> records reversals on the date posted, and cash payouts on the date handed over.</p>
    {error ? <ErrorState message={error} onRetry={() => { setLoading(true); setRevision(value => value + 1) }} /> : loading ? <LoadingState label="Loading sales and payments…" /> : <>
      <div className="stat-grid"><div><span>Total revenue</span><strong><Money amount={totals.revenue} /></strong></div><div><span>Cost of goods sold</span><strong><Money amount={totals.cogs} /></strong></div><div><span>Gross profit</span><strong><Money amount={totals.profit} /></strong></div><div><span>Completed sales</span><strong>{rows.length}</strong><small>{totals.splits} split payments</small></div></div>
      <div className="report-breakdown"><section className="panel"><h2>By sales channel</h2><dl className="definition-list"><div><dt>Point of sale</dt><dd><Money amount={totals.pos} /></dd></div><div><dt>Online store</dt><dd><Money amount={totals.online} /></dd></div></dl></section><section className="panel"><h2>By payment tender</h2><dl className="definition-list"><div><dt>MICA Money</dt><dd><Money amount={totals.wallet} /></dd></div><div><dt>Cash applied to sales</dt><dd><Money amount={totals.cash} /></dd></div></dl><p className="muted">Cash totals exclude change returned.</p></section></div>
      {totals.wallet + totals.cash !== totals.revenue && <ErrorState message="Payment totals need reconciliation. Contact your administrator before closing the day." />}
      {!compact && <section className="panel"><h2>Transaction register</h2>{rows.length === 0 ? <EmptyState title="No sales in this period">Choose another date range to view activity.</EmptyState> : <div className="table-scroll" tabIndex={0} role="region" aria-label="Transaction register"><table><thead><tr><th>Receipt</th><th>Channel / payment</th><th>Student</th><th className="numeric">Revenue</th><th className="numeric">MICA Money</th><th className="numeric">Cash</th><th className="numeric">Received / change</th><th className="numeric">COGS</th><th className="numeric">Gross profit</th></tr></thead><tbody>{rows.map(row => <tr key={row.receipt_number}><td><strong>{row.receipt_number}</strong><small>{new Date(row.sold_at).toLocaleString('en-GB', { timeZone: BUSINESS_TIMEZONE })}</small><small>{row.cashier_name}</small></td><td>{row.channel === 'POS' ? 'Point of sale' : 'Online store'}<small>{row.tender_mode === 'WALLET' ? 'MICA Money' : row.tender_mode === 'CASH' ? 'Cash' : 'MICA Money + cash'}</small></td><td>{row.student_name ?? 'Cash customer'}</td><td className="numeric"><Money amount={row.revenue_won} /></td><td className="numeric"><Money amount={row.wallet_tender_won} /></td><td className="numeric"><Money amount={row.cash_tender_won} /></td><td className="numeric">{row.cash_received_won === null ? '—' : <><Money amount={row.cash_received_won} /><small>Change <Money amount={row.change_given_won ?? 0} /></small></>}</td><td className="numeric"><Money amount={row.cogs_won} /></td><td className="numeric"><Money amount={row.gross_profit_won} /></td></tr>)}</tbody></table></div>}</section>}
    </>}
  </section>
}
