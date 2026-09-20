'use client'
import { useId, useRef, useState } from 'react'
import { apiFetch, ClientApiError } from '@/lib/api/client'
import { formatWon } from '@/lib/format/currency'
import { PartialQuoteInputSchema, PartialQuoteDecisionSchema, PostPartialRefundSchema, type PartialSnapshot, type PartialQuote, type PartialSelection, type PostPartialRefundInput } from '../partial-domain'
type Props = { snapshot: PartialSnapshot; canPost: boolean; onSubmit: (v: PostPartialRefundInput) => Promise<void> }
export function PartialRefundEditor({ snapshot, canPost, onSubmit }: Props) {
  const [counts, setCounts] = useState<Record<string, { restock_quantity: number; write_off_quantity: number }>>({})
  const [quote, setQuote] = useState<PartialQuote | null>(null), [error, setError] = useState(''), [busy, setBusy] = useState(false)
  const [verified, setVerified] = useState(false), [notes, setNotes] = useState(''), [reason, setReason] = useState('')
  const [returnReason, setReturnReason] = useState(''), working = useRef(false)
  const fieldId = useId()
  const isReturn = snapshot.sale.channel === 'ONLINE_STORE'
  const selections = (): PartialSelection[] => Object.entries(counts).filter(([,v]) => v.restock_quantity + v.write_off_quantity > 0).map(([original_allocation_id,v]) => ({ original_allocation_id,...v }))
  function edit(id: string, field: 'restock_quantity' | 'write_off_quantity', value: string) {
    setCounts(v => ({ ...v,[id]: { ...(v[id] ?? { restock_quantity: 0,write_off_quantity: 0 }),[field]: Number(value) } }))
    setQuote(null); setVerified(false); setError('')
  }
  async function calculate() {
    if (working.current) return
    const parsed = PartialQuoteInputSchema.safeParse({ saleId: snapshot.sale.sale_id, items: selections() })
    if (!parsed.success) { setError('Select at least one whole unit from its original lot.'); return }
    working.current = true; setBusy(true); setQuote(null); setVerified(false); setError('')
    try {
      const value = PartialQuoteDecisionSchema.parse(await apiFetch<unknown>('/api/refunds/items/quote',{ method: 'POST',body: JSON.stringify(parsed.data) }))
      if (value.outcome === 'READY') setQuote(value)
      else setError(`Calculation refused: ${value.outcome.replaceAll('_',' ')}. Reload the sale and inspect remaining quantities and expiry.`)
    } catch (e) { setError(e instanceof ClientApiError ? e.message : 'Calculation failed. Nothing was refunded; retry after reconnecting.') }
    finally { working.current = false; setBusy(false) }
  }
  return <section className="panel" aria-label="Inspected original lots"><h2>Select inspected goods by original lot</h2>
    <p>All selected goods, including damaged write-offs, must be physically back with staff. Match the stock receipt and lot below. Do not use this workflow for unverified missing goods or guess which lot was returned.</p>
    <form className="form-stack" onSubmit={async event => {
      event.preventDefault(); if (!quote || !canPost || working.current) return
      const parsed = PostPartialRefundSchema.safeParse({ saleId: snapshot.sale.sale_id, idempotencyKey: crypto.randomUUID(), items: selections(),
        expectedRefundCount: quote.prior_refund_count, reasonCode: reason, notes, verified, ...(isReturn ? { returnReason } : {}) })
      if (!parsed.success) { setError('Confirm inspection, choose the reason and enter 10–500 characters of notes.'); return }
      working.current = true; setBusy(true); setError('')
      try { await onSubmit(parsed.data) } finally { working.current = false; setBusy(false) }
    }}><fieldset className="form-fields" disabled={busy}><legend>Remaining original allocations</legend>
      {snapshot.allocations.filter(a => a.remaining_quantity > 0).map((a,index) => <div className="form-stack" key={a.original_allocation_id}>
        <strong>{a.product_name} · {a.remaining_quantity} remaining of {a.sold_quantity} sold from this lot</strong>
        <p style={{ overflowWrap: 'anywhere' }}>Receipt {a.stock_receipt} · Lot {a.lot_code ?? a.inventory_lot_id} · Expiry {a.expiration_date ?? 'not recorded'}</p>
        <label className="field"><span>Saleable units — lot {index+1}</span><input type="number" inputMode="numeric" min={0} max={a.remaining_quantity} step={1} value={counts[a.original_allocation_id]?.restock_quantity ?? 0} onChange={e => edit(a.original_allocation_id,'restock_quantity',e.target.value)} /></label>
        <label className="field"><span>Damaged / write-off units — lot {index+1}</span><input type="number" inputMode="numeric" min={0} max={a.remaining_quantity} step={1} value={counts[a.original_allocation_id]?.write_off_quantity ?? 0} onChange={e => edit(a.original_allocation_id,'write_off_quantity',e.target.value)} /></label>
      </div>)}
      <button className="secondary-action" type="button" onClick={() => void calculate()}>Review inspected refund</button>
      {quote && <section aria-label="Inspected refund review" aria-live="polite"><h3>Review refund: {formatWon(quote.refund_won)}</h3>
        <p>Wallet credit {formatWon(quote.wallet_credit_won)} · Cash still to hand over {formatWon(quote.cash_due_won)}</p>
        <p>Original cost reversed {formatWon(quote.cogs_reversed_won)} · Saleable stock cost {formatWon(quote.restocked_cost_won)} · Write-off cost {formatWon(quote.write_off_cost_won)}</p>
        <p>Previously refunded {formatWon(quote.previous_refund_won)}. {quote.fully_returned ? 'This selection returns every remaining unit.' : 'Other units remain with the customer.'}</p>
        <p>No refund is posted by this calculation. It reserves nothing. Posting recalculates under locks and rejects a changed refund history. Original coupon redemption is retained.</p>
        {canPost && <>
          {isReturn && <label className="field"><span id={`${fieldId}-return`}>Inspected return type</span><select aria-labelledby={`${fieldId}-return`} required value={returnReason} onChange={e => { setReturnReason(e.target.value); setVerified(false) }}><option value="">Choose return type</option><option value="CUSTOMER_RETURN">Customer return</option>{snapshot.sale.order_status === 'OUT_FOR_DELIVERY' && <option value="FAILED_DELIVERY">Failed delivery — selected goods returned</option>}</select></label>}
          <label className="field"><span id={`${fieldId}-reason`}>Item refund reason</span><select aria-labelledby={`${fieldId}-reason`} required value={reason} onChange={e => { setReason(e.target.value); setVerified(false) }}><option value="">Choose reason</option><option value="CUSTOMER_RETURN">Customer return</option><option value="DAMAGED">Damaged returned goods</option><option value="PRICING_ERROR">Pricing error correction</option><option value="OTHER">Other approved correction</option></select></label>
          <label className="field"><span>Inspection and refund notes</span><textarea required minLength={10} maxLength={500} value={notes} onChange={e => { setNotes(e.target.value); setVerified(false) }} /></label>
          <label><input type="checkbox" required checked={verified} onChange={e => setVerified(e.target.checked)} /> I verified the receipt, customer, physical goods, original lots and this exact refund.</label>
          <p>Posting credits the original wallet portion. It does not dispense cash. Any cash handover must be recorded separately, once.</p>
          <button className="primary-action" disabled={!verified || !reason || notes.trim().length < 10 || (isReturn && !returnReason)}>Post inspected item refund</button>
        </>}
      </section>}
    </fieldset></form>{error && <p role="alert" className="error-message">{error}</p>}
  </section>
}
