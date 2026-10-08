'use client'
import { ErrorState, LoadingState } from '@/components/ui/Feedback'
import { BUSINESS_TIMEZONE } from '@/lib/format/business-time'

import { useEffect, useMemo, useState } from 'react'
import type { CouponReportRow } from '@/features/reports/domain'
import { fetchCouponReport } from '@/features/reports/client'
import { formatWon } from '@/lib/format/currency'

export function CouponReportPanel() {
  const [rows, setRows] = useState<CouponReportRow[]>([])
  const [error, setError] = useState<string | null>(null)

  const [loading, setLoading] = useState(true)
  const [revision, setRevision] = useState(0)

  useEffect(() => {
    let active = true
    void fetchCouponReport()
      .then((result) => { if (active) { setRows(result); setError(null) } })
      .catch((caught: unknown) => { if (active) setError(caught instanceof Error ? caught.message : 'Coupon report could not be loaded') })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [revision])

  const totals = useMemo(() => rows.reduce((current, row) => ({
    redemptions: current.redemptions + row.redemption_count,
    discounts: current.discounts + row.discount_given_won,
    revenue: current.revenue + row.sales_revenue_won,
  }), { redemptions: 0, discounts: 0, revenue: 0 }), [rows])

  return <section className="panel table-panel coupon-report-panel">
    <div className="panel-heading">
      <div><p className="eyebrow">Read-only financial report</p><h2>Coupon performance</h2></div>
      <span className="status-pill">{loading || error ? '—' : totals.redemptions} redemptions</span>
    </div>
    {loading ? <LoadingState label="Loading coupon performance…" /> : error ? <ErrorState message={error} onRetry={() => { setLoading(true); setRevision(value => value + 1) }} /> : <>
    <div className="report-summary">
      <div><span>Discounts issued</span><strong>{formatWon(totals.discounts)}</strong></div>
      <div><span>Coupon sales revenue</span><strong>{formatWon(totals.revenue)}</strong></div>
    </div>
    <div className="table-scroll">
      <table>
        <thead><tr><th>Coupon</th><th>Uses</th><th>Discounts</th><th>Net sales</th><th>Last redeemed</th></tr></thead>
        <tbody>
          {rows.length === 0 && <tr><td colSpan={5} className="muted">No coupon activity recorded.</td></tr>}
          {rows.map((row) => <tr key={`${row.coupon_name}-${row.code_masked}`}>
            <td><strong>{row.coupon_name}</strong><small>{row.code_masked}</small></td>
            <td>{row.redemption_count}</td>
            <td>{formatWon(row.discount_given_won)}</td>
            <td>{formatWon(row.sales_revenue_won)}</td>
            <td>{row.last_redeemed_at ? new Date(row.last_redeemed_at).toLocaleString('en-GB', { timeZone: BUSINESS_TIMEZONE }) : 'Not used'}</td>
          </tr>)}
        </tbody>
      </table>
    </div></> }
  </section>
}
