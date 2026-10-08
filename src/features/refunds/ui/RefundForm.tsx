'use client'
import { useEffect, useId, useRef, useState } from 'react'
import { formatWon } from '@/lib/format/currency'
import type { PostRefundInput, RefundSale } from '../domain'
import { useCashReadiness } from './useCashReadiness'

type Draft = Omit<PostRefundInput, 'saleId' | 'idempotencyKey'> & { returnReason?: 'FAILED_DELIVERY' | 'CUSTOMER_RETURN' }
export function RefundForm({ sale, busy, onSubmit, allowReturns = false }: { sale: RefundSale; busy: boolean; allowReturns?: boolean; onSubmit: (draft: Draft) => void | Promise<void> }) {
  const fieldId = useId()
  const readiness = useCashReadiness('saleId', sale.sale_id, sale.cash_tender_won > 0)
  const [reason, setReason] = useState('')
  const [notes, setNotes] = useState('')
  const [verified, setVerified] = useState(false)
  const [dispositions, setDispositions] = useState<Record<string, 'RESTOCK' | 'WRITE_OFF'>>({})
  const [returnReason, setReturnReason] = useState<'FAILED_DELIVERY' | 'CUSTOMER_RETURN' | ''>('')
  const [submitting, setSubmitting] = useState(false)
  const inFlight = useRef(false)
  useEffect(() => () => { inFlight.current = false }, [])
  const isReturn = sale.channel === 'ONLINE_STORE' && ['OUT_FOR_DELIVERY','DELIVERED'].includes(sale.order_status ?? '')
  const eligible = (allowReturns && isReturn) || sale.channel === 'POS' || ['PLACED', 'PICKING', 'READY'].includes(sale.order_status ?? '')
  if (!eligible) return <p role="status">This order has been dispatched or closed. Pre-dispatch cancellation is not available. A separate return workflow is required.</p>
  return <form className="form-stack" onSubmit={async event => {
    event.preventDefault()
    if (inFlight.current || busy || !readiness.isCurrent() || !verified || !reason || (isReturn && !returnReason) || notes.trim().length < 10 || sale.items.some(item => !dispositions[item.sale_item_id])) return
    inFlight.current = true; setSubmitting(true)
    try {
      if (!await readiness.check() || !inFlight.current) return
      await onSubmit({ ...(isReturn ? { returnReason: returnReason as 'FAILED_DELIVERY' | 'CUSTOMER_RETURN' } : {}), reasonCode: reason as Draft['reasonCode'], notes, verified: true, items: sale.items.map(item => ({ sale_item_id: item.sale_item_id, disposition: dispositions[item.sale_item_id] })) })
    } finally { inFlight.current = false; setSubmitting(false) }
  }}>
    <fieldset disabled={busy || submitting} className="form-fields"><legend>{isReturn ? 'Verified post-dispatch return' : 'Full-sale reversal'}</legend>
      {isReturn && <><p>Confirm that every item has been returned to staff and inspected. Record damaged returned items as write-offs; do not use this action for unverified missing goods.</p><label className="field"><span id={`${fieldId}-return-type`}>Return type</span><select aria-labelledby={`${fieldId}-return-type`} required value={returnReason} onChange={e => setReturnReason(e.target.value as typeof returnReason)}><option value="">Choose return type</option>{sale.order_status === 'OUT_FOR_DELIVERY' && <option value="FAILED_DELIVERY">Failed delivery — goods returned</option>}<option value="CUSTOMER_RETURN">Customer return — goods inspected</option></select></label></>}
      <p>Original payment: <strong>{formatWon(sale.total_won)}</strong>. Wallet credit {formatWon(sale.wallet_tender_won)}; cash due {formatWon(sale.cash_tender_won)}. The cash amount excludes change already returned.</p>
      <p className="muted">Every item is reversed in full. Restock only goods physically verified as saleable. Write off records the original cost as a loss without increasing stock.</p>
      {sale.items.map(item => <label className="field" key={item.sale_item_id}><span>{item.product_name} · {item.quantity} units · original cost {formatWon(item.cogs_won)}</span>
        <select required aria-label={`Disposition for ${item.product_name}`} value={dispositions[item.sale_item_id] ?? ''} onChange={event => setDispositions({ ...dispositions, [item.sale_item_id]: event.target.value as 'RESTOCK' | 'WRITE_OFF' })}>
          <option value="">Choose disposition</option><option value="RESTOCK">Return to saleable stock</option><option value="WRITE_OFF">Write off — no saleable stock returned</option>
        </select></label>)}
      <label className="field"><span id={`${fieldId}-refund-reason`}>Refund reason</span><select aria-labelledby={`${fieldId}-refund-reason`} required value={reason} onChange={event => setReason(event.target.value)}><option value="">Choose a reason</option><option value="CUSTOMER_RETURN">Customer return</option><option value="ORDER_CANCELLED">Order cancelled</option><option value="DAMAGED">Damaged goods</option><option value="PRICING_ERROR">Pricing error</option><option value="OTHER">Other approved correction</option></select></label>
      <label className="field"><span>Refund notes</span><textarea required minLength={10} maxLength={500} value={notes} onChange={event => setNotes(event.target.value)} /></label>
      <p className="muted">Coupon policy: keep the original redemption. Refund only the amount paid; do not automatically restore the coupon allowance.</p>
      <label><input type="checkbox" required checked={verified} onChange={event => setVerified(event.target.checked)} /> I verified this receipt, customer, and the disposition of every item; for a post-dispatch return, all goods are back with staff.</label>
      <p>Posting records the reversal and wallet credit. It does not dispense cash. An authorized payout operator must separately record any handover at this terminal.</p>
      {sale.cash_tender_won > 0 && <><p role="status">{readiness.message}</p><button type="button" className="secondary-action" onClick={() => void readiness.check()}>Check cash readiness</button></>}
      <button className="primary-action" disabled={!readiness.allowed || !verified || !reason || (isReturn && !returnReason) || notes.trim().length < 10 || sale.items.some(item => !dispositions[item.sale_item_id])}>{busy ? 'Posting reversal…' : submitting ? 'Checking cash readiness…' : isReturn ? 'Post inspected return' : 'Post full refund'}</button>
    </fieldset>
  </form>
}
