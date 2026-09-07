'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import type { CatalogProduct } from '@/features/pos/domain'
import type { SessionContext } from '@/features/auth/domain'
import { postReceipt, recoverReceipt, type ReceiptInput } from '@/features/inventory/client'
import { ReceiveStockSchema } from '@/features/inventory/domain'
import { calculateLandedCosts } from '@/features/inventory/costing'
import { apiFetch, ClientApiError } from '@/lib/api/client'
import { formatWon } from '@/lib/format/currency'

function emptyForm() {
  return { supplierName: '', supplierInvoice: '', purchaseDate: new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Seoul' }), shippingWon: 0, otherCostsWon: 0, discountWon: 0, notes: '', productId: '', quantity: 1, purchaseUnitCostWon: 0, expirationDate: '' }
}
const recoveryKey = (userId: string) => `mica-money:pending-stock-receipt:${userId}`

export function ReceiptForm({ products, onSaved }: { products: CatalogProduct[]; onSaved(): void }) {
  const [form, setForm] = useState(emptyForm)
  const pending = useRef(false)
  const requestKey = useRef<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [uncertain, setUncertain] = useState(false)
  const [userId, setUserId] = useState<string | null>(null)
  const [revision, setRevision] = useState(0)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let active = true
    apiFetch<SessionContext>('/api/auth/session').then(session => {
      if (!active) return
      const raw = sessionStorage.getItem(recoveryKey(session.user_id))
      if (raw) {
        const stored = ReceiveStockSchema.safeParse(JSON.parse(raw))
        if (stored.success && stored.data.lines.length === 1) {
          const input = stored.data; const line = input.lines[0]
          requestKey.current = input.idempotencyKey; setUncertain(true)
          setForm({ supplierName: input.supplierName, supplierInvoice: input.supplierInvoice, purchaseDate: input.purchaseDate, shippingWon: input.shippingWon, otherCostsWon: input.otherCostsWon, discountWon: input.discountWon, notes: input.notes ?? '', productId: line.productId, quantity: line.quantity, purchaseUnitCostWon: line.purchaseUnitCostWon, expirationDate: line.expirationDate ?? '' })
        }
      }
      setUserId(session.user_id); setError(null)
    }).catch(() => { if (active) setError('The receipt workspace could not be opened safely. Try again to recover any pending receipt.') })
    return () => { active = false }
  }, [revision])
  const preview = useMemo(() => {
    try { return calculateLandedCosts([{ id: 'line', quantity: form.quantity, purchaseUnitCostWon: form.purchaseUnitCostWon }], form.shippingWon, form.otherCostsWon, form.discountWon)[0] }
    catch { return null }
  }, [form])
  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (pending.current || !userId) return
    pending.current = true; setBusy(true); setError(null); setMessage(null)
    requestKey.current ??= crypto.randomUUID()
    const input: ReceiptInput = { supplierName: form.supplierName, supplierInvoice: form.supplierInvoice, purchaseDate: form.purchaseDate, shippingWon: form.shippingWon, otherCostsWon: form.otherCostsWon, discountWon: form.discountWon, notes: form.notes, lines: [{ productId: form.productId, quantity: form.quantity, purchaseUnitCostWon: form.purchaseUnitCostWon, expirationDate: form.expirationDate || null }] }
    try { sessionStorage.setItem(recoveryKey(userId), JSON.stringify({ ...input, idempotencyKey: requestKey.current })) }
    catch { setError('Your browser could not prepare a safe receipt. Please try another browser.'); pending.current = false; setBusy(false); return }
    try {
      let result = uncertain
        ? (await recoverReceipt(requestKey.current)).receipt
        : null
      if (!result) {
        // A null lookup may race an in-flight request. Only replay the exact saved UUID.
        // The database inserts its unique idempotency row before any inventory mutation.
        try { result = await postReceipt(input, requestKey.current) as { receipt_number: string } }
        catch (caught) {
          if (caught instanceof ClientApiError && caught.status === 409) {
            result = (await recoverReceipt(requestKey.current)).receipt
            if (!result) throw caught
          } else throw caught
        }
      }
      try { sessionStorage.removeItem(recoveryKey(userId)) } catch { /* An old key can safely replay its existing receipt. */ }
      setMessage(`Receipt ${(result as { receipt_number: string }).receipt_number} posted. Stock and purchase costs have been recorded.`)
      setForm(emptyForm()); setUncertain(false); requestKey.current = null; onSaved()
    } catch (caught) {
      if (!(caught instanceof ClientApiError) || caught.status >= 500) setUncertain(true)
      else if (!uncertain) { try { sessionStorage.removeItem(recoveryKey(userId)) } catch {} requestKey.current = null }
      setError(caught instanceof Error ? caught.message : 'The receipt result could not be confirmed. Retry the same receipt to check its result.')
    } finally { pending.current = false; setBusy(false) }
  }
  function set<K extends keyof typeof form>(key: K, value: (typeof form)[K]) { requestKey.current = null; setForm(current => ({ ...current, [key]: value })) }
  return <form className="panel form-grid" onSubmit={submit} aria-busy={busy}>
    <div className="panel-heading span-two"><div><p className="eyebrow">Stock receipt</p><h2>Receive purchased stock</h2></div><span className="status-pill">Costed receipt</span></div>
    {message && <p className="success-message span-two" role="status">{message}</p>}
    {uncertain && <p className="notice span-two" role="status">A receipt needs confirmation. Retry this same receipt to check its result before recording another. Its reference is saved for you if you need to sign in again.</p>}
    <fieldset className="form-grid span-two" disabled={busy || uncertain || !userId}>
      <label className="field"><span>Supplier</span><input required maxLength={160} value={form.supplierName} onChange={e => set('supplierName', e.target.value)} /></label>
      <label className="field"><span>Supplier invoice</span><input required maxLength={120} value={form.supplierInvoice} onChange={e => set('supplierInvoice', e.target.value)} /></label>
      <label className="field"><span>Purchase date</span><input type="date" required value={form.purchaseDate} onChange={e => set('purchaseDate', e.target.value)} /></label>
      <label className="field"><span>Product</span><select required value={form.productId} onChange={e => set('productId', e.target.value)}><option value="">Select</option>{products.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
      <label className="field"><span>Quantity</span><input type="number" min="1" max="1000000" required value={form.quantity} onChange={e => set('quantity', Number(e.target.value))} /></label>
      <label className="field"><span>Purchase cost per unit (₩)</span><input type="number" min="0" max="10000000" required value={form.purchaseUnitCostWon} onChange={e => set('purchaseUnitCostWon', Number(e.target.value))} /></label>
      <label className="field"><span>Shipping (₩)</span><input type="number" min="0" max="100000000" value={form.shippingWon} onChange={e => set('shippingWon', Number(e.target.value))} /></label>
      <label className="field"><span>Other costs (₩)</span><input type="number" min="0" max="100000000" value={form.otherCostsWon} onChange={e => set('otherCostsWon', Number(e.target.value))} /></label>
      <label className="field"><span>Discount (₩)</span><input type="number" min="0" max="100000000" value={form.discountWon} onChange={e => set('discountWon', Number(e.target.value))} /></label>
      <label className="field"><span>Expiration date</span><input type="date" value={form.expirationDate} onChange={e => set('expirationDate', e.target.value)} /></label>
      <label className="field span-two"><span>Notes</span><input maxLength={500} value={form.notes} onChange={e => set('notes', e.target.value)} /></label>
    </fieldset>
    {preview && <div className="cost-preview span-two"><span>Base {formatWon(preview.baseCostWon)}</span><span>Landed total {formatWon(preview.totalLandedCostWon)}</span><strong>Estimated unit cost {formatWon(preview.landedUnitCostWon)}</strong></div>}
    <button className="primary-action" disabled={busy || !userId || !form.productId || !preview}>{busy ? (uncertain ? 'Checking receipt…' : 'Recording…') : uncertain ? 'Check saved stock receipt' : 'Post stock receipt'}</button>
    {error && <p className="error-message span-two" role="alert">{error}{!userId && <button className="text-action" type="button" onClick={() => setRevision(value => value + 1)}>Try again</button>}</p>}
  </form>
}
