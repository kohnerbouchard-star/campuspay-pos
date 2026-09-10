'use client'
import { useEffect, useState } from 'react'
import type { z } from 'zod'
import { apiFetch } from '@/lib/api/client'
import { Money } from '@/components/ui/Money'
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/Feedback'
import type { InventoryReportSchema, WalletReportSchema } from '../domain'
import { formatBusinessTime } from '@/lib/format/business-time'

function useReport<T>(url: string) {
  const [rows, setRows] = useState<T[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [revision, setRevision] = useState(0)
  useEffect(() => {
    let active = true
    apiFetch<T[]>(url).then(data => { if (active) { setRows(data); setError(null); setLoading(false) } })
      .catch(() => { if (active) { setError('This report could not be loaded.'); setLoading(false) } })
    return () => { active = false }
  }, [url, revision])
  return { rows, feedback: loading ? <LoadingState /> : error ? <ErrorState message={error} onRetry={() => { setLoading(true); setRevision(value => value + 1) }} /> : rows.length === 0 ? <EmptyState title="No report entries yet" /> : null }
}

export function InventoryReport() {
  const { rows, feedback } = useReport<z.infer<typeof InventoryReportSchema>[number]>('/api/reports/inventory')
  return <section className="panel section-spacer"><h2>Inventory value</h2>{feedback ?? <div className="table-scroll" role="region" aria-label="Inventory report" tabIndex={0}><table><thead><tr><th>Product / SKU</th><th className="numeric">On hand</th><th className="numeric">Inventory value</th><th>Status</th></tr></thead><tbody>{rows.map(row => <tr key={row.sku}><td><strong>{row.product_name}</strong><small>{row.sku}</small></td><td className="numeric">{row.quantity_on_hand}</td><td className="numeric"><Money amount={row.inventory_value_won} /></td><td>{row.low_stock ? 'Low stock' : 'Available'}</td></tr>)}</tbody></table></div>}</section>
}

export function WalletReport() {
  const { rows, feedback } = useReport<z.infer<typeof WalletReportSchema>[number]>('/api/reports/wallets')
  return <section className="panel section-spacer"><h2>Wallet balances</h2>{feedback ?? <div className="table-scroll" role="region" aria-label="Wallet report" tabIndex={0}><table><thead><tr><th>Student</th><th className="numeric">Balance</th><th className="numeric">Debt</th><th>Last activity · KST</th></tr></thead><tbody>{rows.map(row => <tr key={row.student_code}><td><strong>{row.display_name}</strong><small>{row.student_code}</small></td><td className="numeric"><Money amount={row.balance_won} /></td><td className="numeric"><Money amount={row.debt_won} /></td><td>{row.last_changed_at ? formatBusinessTime(row.last_changed_at) : 'No activity'}</td></tr>)}</tbody></table></div>}</section>
}
