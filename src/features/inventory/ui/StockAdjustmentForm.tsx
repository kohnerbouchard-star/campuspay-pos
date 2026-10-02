'use client'
import { useEffect, useRef, useState } from 'react'
import type { CatalogProduct } from '@/features/pos/domain'
import { StockAdjustmentRecoverySchema, type InventoryLot } from '@/features/inventory/domain'
import { readPendingAdjustment, savePendingAdjustment, clearPendingAdjustment, withAdjustmentStorageLock } from '@/features/inventory/adjustment-storage'
import { apiFetch } from '@/lib/api/client'
import { Dialog } from '@/components/ui/Dialog'
export function StockAdjustmentForm({ products, lots, operatorId, onSaved }: { products: CatalogProduct[]; lots: InventoryLot[]; operatorId: string; onSaved(): void }) {
  const [form, setForm] = useState({ productId: '', lotId: '', quantityToRemove: 1, reasonCode: 'DAMAGED', notes: '' })
  const [confirm, setConfirm] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [ready, setReady] = useState(false)
  const [recoveryKey, setRecoveryKey] = useState<string | null>(null)
  const pending = useRef(false)
  const product = products.find(row => row.id === form.productId)
  useEffect(() => {
    let active = true
    const load = () => {
      try { const value = readPendingAdjustment(localStorage, operatorId); if (active) { setRecoveryKey(value); setReady(true) } }
      catch (cause) { if (active) { setReady(false); setError(cause instanceof Error ? cause.message : 'Recovery storage is unavailable.') } }
    }
    void Promise.resolve().then(load)
    window.addEventListener('storage', load)
    return () => { active = false; window.removeEventListener('storage', load) }
  }, [operatorId])
  function set<K extends keyof typeof form>(name: K, value: (typeof form)[K]) { if (!recoveryKey && !pending.current) setForm(current => ({ ...current, [name]: value })) }
  async function recover() {
    if (!recoveryKey || pending.current) return
    pending.current = true; setBusy(true); setError('')
    try {
      const result = StockAdjustmentRecoverySchema.parse(await apiFetch('/api/inventory/adjustments/recover', { method: 'POST', body: JSON.stringify({ idempotencyKey: recoveryKey }) }))
      await withAdjustmentStorageLock(operatorId, () => clearPendingAdjustment(localStorage, operatorId, recoveryKey), navigator.locks); setRecoveryKey(null); setConfirm(false)
      setMessage(result.state === 'POSTED' ? `The original removal is recorded once: ${result.reference_number}. Quantity removed: ${result.quantity_removed}.` : 'The original request is closed without a stock removal. Review the current stock before starting a new request.')
      onSaved()
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Recovery is not confirmed. Keep this request and try recovery again.') }
    finally { pending.current = false; setBusy(false) }
  }
  async function post() {
    if (pending.current || recoveryKey || !ready) return
    const key = crypto.randomUUID()
    pending.current = true; setBusy(true)
    try { await withAdjustmentStorageLock(operatorId, () => savePendingAdjustment(localStorage, operatorId, key), navigator.locks) }
    catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Recovery storage is unavailable. No removal was submitted.')
      try { setRecoveryKey(readPendingAdjustment(localStorage, operatorId)) } catch { setReady(false) }
      pending.current = false; setBusy(false); return
    }
    setRecoveryKey(key); setError('')
    try {
      const result = await apiFetch<{ reference_number: string }>('/api/inventory/adjustments', { method: 'POST', body: JSON.stringify({ ...form, lotId: form.lotId || undefined, idempotencyKey: key }) })
      await withAdjustmentStorageLock(operatorId, () => clearPendingAdjustment(localStorage, operatorId, key), navigator.locks); setRecoveryKey(null)
      setMessage(`${form.quantityToRemove} × ${product?.name} removed from stock. Receipt: ${result.reference_number}`)
      setConfirm(false); onSaved()
    } catch {
      setError('The removal result is not confirmed. Do not submit a new removal. Recover this request, including after refreshing or signing in again.')
      setConfirm(false)
    } finally { pending.current = false; setBusy(false) }
  }
  return <section className="panel">
    {recoveryKey && <div className="uncertain-result form-stack" role="alert"><h3>Resolve previous stock removal</h3><p>A previous request still needs its confirmed result. New removal is blocked until it is recovered.</p><code>{recoveryKey}</code><button type="button" className="secondary-action" disabled={busy} onClick={() => void recover()}>{busy ? 'Checking original request…' : 'Recover original removal'}</button><a href="/login?next=%2Finventory">Sign in as the original operator to recover</a></div>}
    {error && <p className="error-message" role="alert">{error}</p>}{message && <p className="success-message" role="status">{message}</p>}
    <form className="form-grid" onSubmit={event => { event.preventDefault(); if (!recoveryKey && ready) { setConfirm(true); setError(''); setMessage('') } }}>
      <div className="panel-heading"><div><p className="eyebrow">Inventory correction</p><h2>Remove stock</h2></div></div>
      <label className="field"><span>Product</span><select required disabled={busy || !!recoveryKey} value={form.productId} onChange={e => { set('productId', e.target.value); set('lotId', '') }}><option value="">Select product</option>{products.map(row => <option key={row.id} value={row.id}>{row.name} · {row.stock_on_hand} available</option>)}</select></label>
      <label className="field"><span>Inventory lot</span><select disabled={busy || !!recoveryKey} value={form.lotId} onChange={e => set('lotId', e.target.value)}><option value="">Use current costing order</option>{lots.filter(row => row.product_id === form.productId && row.quantity_remaining > 0).map(row => <option key={row.lot_id} value={row.lot_id}>{row.receipt_number} · {row.quantity_remaining} remaining</option>)}</select></label>
      <label className="field"><span>Quantity to remove</span><input required disabled={busy || !!recoveryKey} type="number" min={1} max={product?.stock_on_hand ?? 1} value={form.quantityToRemove} onChange={e => set('quantityToRemove', Number(e.target.value))} /></label>
      <label className="field"><span>Reason</span><select disabled={busy || !!recoveryKey} value={form.reasonCode} onChange={e => set('reasonCode', e.target.value)}><option value="DAMAGED">Damaged</option><option value="EXPIRED">Expired</option><option value="SUPPLIER_RETURN">Returned to supplier</option><option value="STOCK_COUNT_LOSS">Stock count shortage</option></select></label>
      <label className="field span-two"><span>Adjustment notes</span><textarea required disabled={busy || !!recoveryKey} minLength={3} maxLength={500} value={form.notes} onChange={e => set('notes', e.target.value)} /></label>
      <button className="secondary-action" disabled={!ready || busy || !!recoveryKey || !product || !product.stock_on_hand}>Review stock removal</button>
    </form>
    {confirm && <Dialog title="Confirm stock removal" busy={busy} onClose={() => setConfirm(false)}><p>Remove <strong>{form.quantityToRemove} × {product?.name}</strong> from saleable stock?</p><p>{form.notes}</p><p className="muted">This changes inventory and records the cost of the removed units.</p><div className="action-row end"><button disabled={busy} className="secondary-action" onClick={() => setConfirm(false)}>Cancel</button><button disabled={busy || !!recoveryKey} className="primary-action danger-action" onClick={() => void post()}>{busy ? 'Recording adjustment…' : 'Confirm removal'}</button></div></Dialog>}
  </section>
}
