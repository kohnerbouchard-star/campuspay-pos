'use client'
import { useState } from 'react'
import { formatWon } from '@/lib/format/currency'
import type { PostRefundInput, RefundSale } from '../domain'

type Draft = Omit<PostRefundInput, 'saleId' | 'idempotencyKey'>
export function RefundForm({ sale, busy, onSubmit }: { sale: RefundSale; busy: boolean; onSubmit: (draft: Draft) => void }) {
  const [reason, setReason] = useState('')
  const [notes, setNotes] = useState('')
  const [verified, setVerified] = useState(false)
  const [dispositions, setDispositions] = useState<Record<string, 'RESTOCK' | 'WRITE_OFF'>>({})
  const eligible = sale.channel === 'POS' || ['PLACED', 'PICKING', 'READY'].includes(sale.order_status ?? '')
  if (!eligible) return <p role="status">This order has been dispatched or closed. Pre-dispatch cancellation is not available. A separate return workflow is required.</p>
  return <form className="form-stack" onSubmit={event => {
    event.preventDefault()
    if (!verified || !reason || notes.trim().length < 10 || sale.items.some(item => !dispositions[item.sale_item_id])) return
    onSubmit({ reasonCode: reason as Draft['reasonCode'], notes, verified: true, items: sale.items.map(item => ({ sale_item_id: item.sale_item_id, disposition: dispositions[item.sale_item_id] })) })
  }}>
    <fieldset disabled={busy} className="form-fields"><legend>Full-sale reversal</legend>
      <p>Original payment: <strong>{formatWon(sale.total_won)}</strong>. Wallet credit {formatWon(sale.wallet_tender_won)}; cash due {formatWon(sale.cash_tender_won)}. The cash amount excludes change already returned.</p>
      <p className="muted">Every item is reversed in full. Restock only goods physically verified as saleable. Write off records the original cost as a loss without increasing stock.</p>
      {sale.items.map(item => <label className="field" key={item.sale_item_id}><span>{item.product_name} · {item.quantity} units · original cost {formatWon(item.cogs_won)}</span>
        <select required aria-label={`Disposition for ${item.product_name}`} value={dispositions[item.sale_item_id] ?? ''} onChange={event => setDispositions({ ...dispositions, [item.sale_item_id]: event.target.value as 'RESTOCK' | 'WRITE_OFF' })}>
          <option value="">Choose disposition</option><option value="RESTOCK">Return to saleable stock</option><option value="WRITE_OFF">Write off — no saleable stock returned</option>
        </select></label>)}
      <label className="field"><span>Refund reason</span><select required value={reason} onChange={event => setReason(event.target.value)}><option value="">Choose a reason</option><option value="CUSTOMER_RETURN">Customer return</option><option value="ORDER_CANCELLED">Order cancelled</option><option value="DAMAGED">Damaged goods</option><option value="PRICING_ERROR">Pricing error</option><option value="OTHER">Other approved correction</option></select></label>
      <label className="field"><span>Refund notes</span><textarea required minLength={10} maxLength={500} value={notes} onChange={event => setNotes(event.target.value)} /></label>
      <p className="muted">Coupon policy: keep the original redemption. Refund only the amount paid; do not automatically restore the coupon allowance.</p>
      <label><input type="checkbox" required checked={verified} onChange={event => setVerified(event.target.checked)} /> I verified this receipt, customer, and the disposition of every item.</label>
      <p>Posting records the reversal and wallet credit. It does not dispense cash. Any cash handover must be recorded separately by this operator at this terminal.</p>
      <button className="primary-action" disabled={!verified || !reason || notes.trim().length < 10 || sale.items.some(item => !dispositions[item.sale_item_id])}>{busy ? 'Posting reversal…' : 'Post full refund'}</button>
    </fieldset>
  </form>
}
