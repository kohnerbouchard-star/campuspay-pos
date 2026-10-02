'use client'
import { useEffect, useRef, useState } from 'react'
import type { CatalogProduct } from '@/features/pos/domain'
import type { InventoryLot } from '@/features/inventory/domain'
import { apiFetch } from '@/lib/api/client'
import { Dialog } from '@/components/ui/Dialog'
const STORAGE_KEY = 'campuspay.pending-stock-removal.v1'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export function StockAdjustmentForm({ products, lots, onSaved }: { products: CatalogProduct[]; lots: InventoryLot[]; onSaved(): void }) {
  const [form, setForm] = useState({ productId: '', lotId: '', quantityToRemove: 1, reasonCode: 'DAMAGED', notes: '' })
  const [confirm, setConfirm] = useState(false)
  const [busy, setBusy] = useState(false)
  const [ready, setReady] = useState(false)
  const [operation, setOperation] = useState<string | null>(null)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const pending = useRef(false)
  const product = products.find(row => row.id === form.productId)
  useEffect(() => {
    let active = true
    void Promise.resolve().then(() => {
    if (!active) return
    try {
      const id = sessionStorage.getItem(STORAGE_KEY)
      if (id && !UUID.test(id)) throw new Error('Invalid recovery record')
      setOperation(id); setReady(true)
    } catch { setError('This browser cannot safely track stock removal. Restore browser storage before continuing.') }
    })
    return () => { active = false }
  }, [])
  function clearOperation() {
    sessionStorage.removeItem(STORAGE_KEY)
    if (sessionStorage.getItem(STORAGE_KEY) !== null) throw new Error('Recovery record could not be cleared')
    setOperation(null)
  }
  async function recover() {
    if (!operation || pending.current) return
    pending.current = true; setBusy(true); setError('')
    try {
      const result = await apiFetch<{ adjustment: { reference_number: string } | null }>('/api/inventory/adjustments/recover', {
        method: 'POST', body: JSON.stringify({ idempotencyKey: operation }),
      })
      clearOperation(); setConfirm(false)
      setMessage(result.adjustment ? `Stock removal confirmed: ${result.adjustment.reference_number}. Do not remove it again.` : 'This request is closed without removing stock. Review the current stock before starting a new removal.')
      onSaved()
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Recovery failed. Keep the original request and sign in as its operator on this register.') }
    finally { pending.current = false; setBusy(false) }
  }
  async function post() {
    if (pending.current || operation || !ready) return
    pending.current = true; setBusy(true); setError('')
    try {
      const id = crypto.randomUUID()
      // Persist before sending, and never replace this key after an uncertain response.
      const previous = sessionStorage.getItem(STORAGE_KEY)
      if (previous) { setOperation(previous); throw new Error('Recover the previous request first. Nothing was submitted.') }
      setOperation(id)
      sessionStorage.setItem(STORAGE_KEY, id)
      if (sessionStorage.getItem(STORAGE_KEY) !== id) throw new Error('The recovery record could not be saved. Nothing was submitted.')
      setOperation(id)
      const result = await apiFetch<{ reference_number: string }>('/api/inventory/adjustments', {
        method: 'POST', body: JSON.stringify({ ...form, lotId: form.lotId || undefined, idempotencyKey: id }),
      })
      clearOperation(); setConfirm(false)
      setMessage(`Stock removal confirmed: ${result.reference_number}.`); onSaved()
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'The result is unknown. Recover this request before another removal.') }
    finally { pending.current = false; setBusy(false) }
  }
  const locked = busy || !ready || !!operation
  return <section className="panel">
    {operation && <div className="notice" role="status"><strong>Previous stock removal needs a confirmed result.</strong><p>Recover it before editing or submitting another removal. The same operator must sign in on this register.</p><button className="secondary-action" disabled={busy} onClick={() => void recover()}>Recover stock removal</button></div>}
    {error && <p className="error-message" role="alert">{error}</p>}
    {message && <p className="success-message" role="status">{message}</p>}
    <form className="form-grid" onSubmit={event => { event.preventDefault(); if (!locked) { setConfirm(true); setError(''); setMessage('') } }}>
      <div className="panel-heading"><h2>Remove stock</h2></div>
      <label className="field"><span>Product</span><select required disabled={locked} value={form.productId} onChange={e => setForm({ ...form, productId: e.target.value, lotId: '' })}><option value="">Select product</option>{products.map(row => <option key={row.id} value={row.id}>{row.name} · {row.stock_on_hand} available</option>)}</select></label>
      <label className="field"><span>Inventory lot</span><select disabled={locked} value={form.lotId} onChange={e => setForm({ ...form, lotId: e.target.value })}><option value="">Use current costing order</option>{lots.filter(row => row.product_id === form.productId && row.quantity_remaining > 0).map(row => <option key={row.lot_id} value={row.lot_id}>{row.receipt_number} · {row.quantity_remaining} remaining</option>)}</select></label>
      <label className="field"><span>Quantity to remove</span><input required disabled={locked} type="number" min={1} max={product?.stock_on_hand ?? 1} value={form.quantityToRemove} onChange={e => setForm({ ...form, quantityToRemove: Number(e.target.value) })} /></label>
      <label className="field"><span>Reason</span><select disabled={locked} value={form.reasonCode} onChange={e => setForm({ ...form, reasonCode: e.target.value })}><option value="DAMAGED">Damaged</option><option value="EXPIRED">Expired</option><option value="SUPPLIER_RETURN">Returned to supplier</option><option value="STOCK_COUNT_LOSS">Stock count shortage</option></select></label>
      <label className="field span-two"><span>Adjustment notes</span><textarea required disabled={locked} minLength={3} maxLength={500} value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} /></label>
      <button className="secondary-action" disabled={locked || !product || !product.stock_on_hand}>Review stock removal</button>
    </form>
    {confirm && <Dialog title="Confirm stock removal" busy={busy} onClose={() => setConfirm(false)}><p>Remove <strong>{form.quantityToRemove} × {product?.name}</strong> from saleable stock?</p><p>{form.notes}</p>{error && <p role="alert">{error}</p>}<div className="action-row end"><button disabled={busy} className="secondary-action" onClick={() => setConfirm(false)}>Close</button>{operation ? <button disabled={busy} className="primary-action" onClick={() => void recover()}>Recover stock removal</button> : <button disabled={locked} className="primary-action danger-action" onClick={() => void post()}>Confirm removal</button>}</div></Dialog>}
  </section>
}
