'use client'
import { useRef, useState } from 'react'
import type { CatalogProduct } from '@/features/pos/domain'
import type { InventoryLot } from '@/features/inventory/domain'
import { apiFetch } from '@/lib/api/client'
import { Dialog } from '@/components/ui/Dialog'
export function StockAdjustmentForm({ products, lots, onSaved,initialProductId='' }: { products: CatalogProduct[]; lots: InventoryLot[]; onSaved(): void;initialProductId?:string }) {
  const [form, setForm] = useState({ productId: initialProductId, lotId: '', quantityToRemove: 1, reasonCode: 'DAMAGED', notes: '' })
  const [confirm, setConfirm] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const pending = useRef(false)
  const key = useRef<string | null>(null)
  const product = products.find(row => row.id === form.productId)
  function set<K extends keyof typeof form>(name: K, value: (typeof form)[K]) { key.current = null; setForm(current => ({ ...current, [name]: value })) }
  async function post() {
    if (pending.current) return
    pending.current = true; setBusy(true); setError(''); key.current ??= crypto.randomUUID()
    try {
      await apiFetch('/api/inventory/adjustments', { method: 'POST', body: JSON.stringify({ ...form, lotId: form.lotId || undefined, idempotencyKey: key.current }) })
      setMessage(`${form.quantityToRemove} × ${product?.name} removed from stock. The adjustment has been recorded.`)
      setConfirm(false); key.current = null; onSaved()
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'The adjustment could not be confirmed. Retry to check the same request.') }
    finally { pending.current = false; setBusy(false) }
  }
  return <section className="panel"><form className="form-grid" onSubmit={event => { event.preventDefault(); setConfirm(true); setError(''); setMessage('') }}><div className="panel-heading"><div><p className="eyebrow">Inventory correction</p><h2>Remove stock</h2></div></div>
    <label className="field"><span>Product</span><select required value={form.productId} onChange={e => { set('productId', e.target.value); set('lotId', '') }}><option value="">Select product</option>{products.map(row => <option key={row.id} value={row.id}>{row.name} · {row.stock_on_hand} available</option>)}</select></label>
    <label className="field"><span>Inventory lot</span><select value={form.lotId} onChange={e => set('lotId', e.target.value)}><option value="">Use current costing order</option>{lots.filter(row => row.product_id === form.productId && row.quantity_remaining > 0).map(row => <option key={row.lot_id} value={row.lot_id}>{row.receipt_number} · {row.quantity_remaining} remaining</option>)}</select></label>
    <label className="field"><span>Quantity to remove</span><input required type="number" min={1} max={product?.stock_on_hand ?? 1} value={form.quantityToRemove} onChange={e => set('quantityToRemove', Number(e.target.value))} /></label>
    <label className="field"><span>Reason</span><select value={form.reasonCode} onChange={e => set('reasonCode', e.target.value)}><option value="DAMAGED">Damaged</option><option value="EXPIRED">Expired</option><option value="SUPPLIER_RETURN">Returned to supplier</option><option value="STOCK_COUNT_LOSS">Stock count shortage</option></select></label>
    <label className="field span-two"><span>Adjustment notes</span><textarea required minLength={3} maxLength={500} value={form.notes} onChange={e => set('notes', e.target.value)} /></label><button className="secondary-action" disabled={!product || !product.stock_on_hand}>Review stock removal</button>
  </form>{message && <p className="success-message" role="status">{message}</p>}{confirm && <Dialog title="Confirm stock removal" busy={busy} onClose={() => setConfirm(false)}><p>Remove <strong>{form.quantityToRemove} × {product?.name}</strong> from saleable stock?</p><p>{form.notes}</p><p className="muted">This changes inventory and records the cost of the removed units.</p>{error && <p className="error-message" role="alert">{error}</p>}<div className="action-row end"><button disabled={busy} className="secondary-action" onClick={() => setConfirm(false)}>Cancel</button><button disabled={busy} className="primary-action danger-action" onClick={() => void post()}>{busy ? 'Recording adjustment…' : 'Confirm removal'}</button></div></Dialog>}</section>
}
