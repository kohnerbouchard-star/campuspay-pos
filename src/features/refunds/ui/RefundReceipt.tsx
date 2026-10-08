'use client'
import { useRef, useState } from 'react'
import { apiFetch } from '@/lib/api/client'
import { formatWon } from '@/lib/format/currency'
import { RefundDecisionSchema, RefundRecordSchema, type RefundRecord } from '../domain'
import { useCashReadiness } from './useCashReadiness'

export function RefundReceipt({ refund, userId, onUpdate }: { refund: RefundRecord; userId: string; onUpdate: (value: RefundRecord) => void }) {
  const [confirmed, setConfirmed] = useState(false)
  const [reference, setReference] = useState('')
  const [busy, setBusy] = useState(false)
  const [unknown, setUnknown] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inFlight = useRef(false)
  const readiness = useCashReadiness('refundId', refund.refund_id, refund.cash_due_won > refund.cash_paid_won)
  async function record() {
    if (inFlight.current || unknown || !readiness.isCurrent() || !confirmed || reference.trim().length < 3) return
    inFlight.current = true; setBusy(true); setError(null)
    try {
      const decision = RefundDecisionSchema.parse(await apiFetch<unknown>('/api/refunds/payout', { method: 'POST', body: JSON.stringify({ refundId: refund.refund_id, idempotencyKey: crypto.randomUUID(), amountWon: refund.cash_due_won, handoverReference: reference, confirmed: true }) }))
      if (!decision.refund || decision.refund.refund_id !== refund.refund_id) throw new Error('Unconfirmed payout')
      onUpdate(decision.refund)
    } catch { setUnknown(true); setError('Payout recording is unconfirmed. Refresh the authoritative status. Do not hand over cash again.') }
    finally { inFlight.current = false; setBusy(false) }
  }
  async function refresh() {
    if (inFlight.current) return
    inFlight.current = true; setBusy(true); setError(null)
    try {
      const current = RefundRecordSchema.parse(await apiFetch<unknown>(`/api/refunds/record?refundId=${refund.refund_id}`))
      if (!current || current.refund_id !== refund.refund_id) throw new Error('Missing refund')
      onUpdate(current); setUnknown(false); setConfirmed(false)
      if (current.cash_paid_won === 0) setError('No cash payout is recorded. Verify whether cash was already handed over; record that handover without paying twice.')
    } catch { setError('Payout status is still unavailable. Stop and reconcile with the original operator.') }
    finally { inFlight.current = false; setBusy(false) }
  }
  const outstanding = refund.cash_due_won - refund.cash_paid_won
  return <section className="panel" aria-labelledby="refund-receipt-heading">
    <h2 id="refund-receipt-heading">Refund recorded</h2><p>Original receipt: <strong>{refund.receipt_number}</strong></p><p style={{ overflowWrap: 'anywhere' }}>Refund reference: {refund.refund_id}</p>
    <dl className="detail-list"><div><dt>Refund total</dt><dd>{formatWon(refund.total_won)}</dd></div><div><dt>Wallet credited</dt><dd>{formatWon(refund.wallet_credit_won)}</dd></div><div><dt>Cash still due</dt><dd>{formatWon(outstanding)}</dd></div><div><dt>Cash handover recorded</dt><dd>{formatWon(refund.cash_paid_won)}</dd></div><div><dt>Original cost reversed</dt><dd>{formatWon(refund.cogs_reversed_won)}</dd></div><div><dt>Stock cost restored</dt><dd>{formatWon(refund.restocked_cost_won)}</dd></div><div><dt>Write-off loss</dt><dd>{formatWon(refund.write_off_cost_won)}</dd></div></dl>
    <p>{refund.scope === 'PARTIAL' ? 'Item-level refund receipt; this is not the cumulative refund total.' : 'Full-sale refund receipt.'}</p>
    {refund.items.map((item,index) => <p key={index}>{item.quantity} × {item.product_name}: {formatWon(item.refund_won)} ({item.restock_quantity} restocked, {item.write_off_quantity} written off)</p>)}
    <p>Coupon redemption is retained. This receipt does not authorize a second refund or a second cash payout.</p>
    {refund.payout_reference && <p role="status">Cash payout recorded: {refund.payout_reference}. Do not pay again.</p>}
    {error && <p role="alert" className="error-message">{error}</p>}
    {outstanding > 0 && <div className="uncertain-result"><h3>Cash handover remains unresolved</h3><p>No cash is dispensed by CampusPay. An authorized payout operator must verify and record one actual handover at the original terminal. Repeated clicks or a recovered receipt are never instructions to pay again.</p>
      <p role="status">{readiness.message}</p>
      {readiness.handoff && <p>The refund was issued by another operator. Verify the original receipt and any prior handover before paying. This handover will be recorded under your identity.</p>}
      <button type="button" className="secondary-action" disabled={busy} onClick={() => { setConfirmed(false); void readiness.check() }}>Check cash readiness</button>
      {userId && readiness.allowed && !unknown && <form className="form-stack" onSubmit={event => { event.preventDefault(); void record() }}>
        <label className="field"><span>Cash handover reference</span><input required minLength={3} maxLength={120} value={reference} onChange={event => setReference(event.target.value)} disabled={busy} /></label>
        <label><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} disabled={busy} required /> I verified that this exact cash amount was handed over once.</label>
        <button className="primary-action" disabled={busy || !confirmed || reference.trim().length < 3}>Record cash paid</button>
      </form>}
      <button type="button" className="secondary-action" disabled={busy} onClick={() => void refresh()}>Refresh payout status</button>
    </div>}
  </section>
}
