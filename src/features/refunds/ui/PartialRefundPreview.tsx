'use client'
import { useId, useRef, useState } from 'react'
import { apiFetch, ClientApiError } from '@/lib/api/client'
import { formatWon } from '@/lib/format/currency'
import type { RefundSale } from '../domain'
import { PartialRefundPreviewInputSchema, PartialRefundPreviewDecisionSchema, PREVIEW_MESSAGES, type PartialRefundPreview } from '../preview-domain'

type Counts = Record<string, { restock_quantity: number; write_off_quantity: number }>
export function PartialRefundPreviewPanel({ sale }: { sale: RefundSale }) {
  const id = useId(), working = useRef(false)
  const [counts, setCounts] = useState<Counts>({}), [busy, setBusy] = useState(false)
  const [preview, setPreview] = useState<PartialRefundPreview | null>(null), [error, setError] = useState('')
  function edit(itemId: string, key: 'restock_quantity' | 'write_off_quantity', value: string) {
    setCounts(v => ({ ...v, [itemId]: { ...(v[itemId] ?? { restock_quantity: 0, write_off_quantity: 0 }), [key]: value === '' ? 0 : Number(value) } }))
    setPreview(null); setError('')
  }
  return <details className="panel"><summary>Calculate item-level refund — preview only</summary>
    <p>No money, inventory, order status, or coupon allowance is changed. This calculator never posts. Use Item refunds and returns for inspected lot selection and authorized posting.</p>
    <form className="form-stack" onSubmit={async event => {
      event.preventDefault(); if (working.current) return
      const parsed = PartialRefundPreviewInputSchema.safeParse({ saleId: sale.sale_id, items: Object.entries(counts)
        .filter(([, v]) => v.restock_quantity !== 0 || v.write_off_quantity !== 0).map(([sale_item_id, v]) => ({ sale_item_id, ...v })) })
      setPreview(null); setError('')
      if (!parsed.success) { setError('Select whole units from at least one original sale line.'); return }
      working.current = true; setBusy(true)
      try {
        const result = PartialRefundPreviewDecisionSchema.parse(await apiFetch<unknown>('/api/refunds/preview', { method: 'POST', body: JSON.stringify(parsed.data) }))
        if (result.outcome === 'PREVIEW') setPreview(result)
        else setError(PREVIEW_MESSAGES[result.outcome])
      } catch (e) { setError(e instanceof ClientApiError ? e.message : 'The estimate could not be loaded. Nothing was refunded; retry the calculation.') }
      finally { working.current = false; setBusy(false) }
    }}>
      <fieldset className="form-fields" disabled={busy}><legend>Select inspected quantities for calculation</legend>
        {sale.items.map(item => <div className="form-stack" key={item.sale_item_id}>
          <strong>{item.product_name} · {item.quantity} units originally sold</strong>
          <label className="field" htmlFor={`${id}-${item.sale_item_id}-restock`}><span>Saleable restock quantity — {item.product_name}</span>
          <input id={`${id}-${item.sale_item_id}-restock`} type="number" inputMode="numeric" min={0} max={item.quantity} step={1}
            value={counts[item.sale_item_id]?.restock_quantity ?? 0} onChange={e => edit(item.sale_item_id, 'restock_quantity', e.target.value)} /></label>
          <label className="field" htmlFor={`${id}-${item.sale_item_id}-writeoff`}><span>Write-off quantity — {item.product_name}</span>
          <input id={`${id}-${item.sale_item_id}-writeoff`} type="number" inputMode="numeric" min={0} max={item.quantity} step={1}
            value={counts[item.sale_item_id]?.write_off_quantity ?? 0} onChange={e => edit(item.sale_item_id, 'write_off_quantity', e.target.value)} /></label>
        </div>)}
        <p className="muted">Original discounts and tender shares are apportioned in whole won. Original-cost allocations are estimates pending physical lot verification; cash excludes change already returned.</p>
        <button className="secondary-action">{busy ? 'Calculating…' : 'Calculate refund preview'}</button>
      </fieldset>
    </form>
    {error && <p className="error-message" role="alert">{error}</p>}
    {preview && <section aria-label="Item-level refund estimate" aria-live="polite">
      <h3>Estimate only — {formatWon(preview.refund_won)}</h3>
      <p>Wallet credit estimate: {formatWon(preview.wallet_credit_won)}. Cash due estimate: {formatWon(preview.cash_due_won)}.</p>
      <p>Original cost reversed: {formatWon(preview.cogs_reversed_won)}. Restock cost: {formatWon(preview.restocked_cost_won)}. Write-off cost: {formatWon(preview.write_off_cost_won)}.</p>
      <div className="table-scroll"><table><caption>Selected original sale lines</caption><thead><tr><th>Item</th><th>Restock / write-off</th><th>Net refund</th></tr></thead>
        <tbody>{preview.items.map(item => <tr key={item.sale_item_id}><td>{item.product_name}</td><td>{item.restock_quantity} / {item.write_off_quantity}</td><td>{formatWon(item.refund_won)}</td></tr>)}</tbody></table></div>
      <p>No refund has been posted. This estimate reserves nothing and may become stale. Coupon redemption remains unchanged.</p>
    </section>}
  </details>
}
