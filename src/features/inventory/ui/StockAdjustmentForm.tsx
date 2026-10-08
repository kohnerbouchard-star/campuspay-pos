'use client'
import { useEffect, useRef, useState } from 'react'
import type { CatalogProduct } from '@/features/pos/domain'
import { StockAdjustmentSchema, StockAdjustmentResultSchema, StockAdjustmentRecoverySchema, type InventoryLot } from '@/features/inventory/domain'
import { readPendingAdjustment, savePendingAdjustment, clearPendingAdjustment, withAdjustmentStorageLock } from '@/features/inventory/adjustment-storage'
import { apiFetch } from '@/lib/api/client'
import { Dialog } from '@/components/ui/Dialog'

export function StockAdjustmentForm({ products, lots, operatorId, onSaved, initialProductId = '' }: {
  products: CatalogProduct[]; lots: InventoryLot[]; operatorId: string; onSaved(): void; initialProductId?: string
}) {
  const [form, setForm] = useState({ productId: initialProductId, lotId: '', quantityToRemove: 1, reasonCode: 'DAMAGED', notes: '' })
  const [confirm, setConfirm] = useState(false)
  const [busy, setBusy] = useState(false)
  const [ready, setReady] = useState(false)
  const [recoveryKey, setRecoveryKey] = useState<string | null>(null)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const pending = useRef(false)
  const mounted = useRef(false)
  const product = products.find(row => row.id === form.productId)
  const selectedLot = lots.find(row => row.lot_id === form.lotId && row.product_id === form.productId)
  const reasonLabels: Readonly<Record<string, string>> = { DAMAGED: 'Damaged', EXPIRED: 'Expired', SUPPLIER_RETURN: 'Returned to supplier', STOCK_COUNT_LOSS: 'Stock count shortage' }
  const blocked = busy || !!recoveryKey || !ready

  useEffect(() => {
    mounted.current = true
    const load = () => {
      try {
        const key = readPendingAdjustment(localStorage, operatorId)
        // Another tab clearing storage is not proof of a server result. Retain
        // our reference until THIS component verifies recovery for that key.
        setRecoveryKey(previous => key ?? previous)
        setReady(!!navigator.locks)
        if (!navigator.locks) setError('This browser cannot coordinate safe stock recovery. No new removal can be submitted.')
      } catch {
        setReady(false)
        setError('Recovery storage is unavailable or invalid. Do not repeat the removal; ask an administrator to investigate.')
      }
    }
    void Promise.resolve().then(() => { if (mounted.current) load() })
    window.addEventListener('storage', load)
    return () => { mounted.current = false; window.removeEventListener('storage', load) }
  }, [operatorId])

  function set<K extends keyof typeof form>(name: K, value: (typeof form)[K]) {
    if (!blocked && !pending.current) setForm(current => ({ ...current, [name]: value }))
  }
  async function finish(key: string, text: string) {
    await withAdjustmentStorageLock(operatorId, () => clearPendingAdjustment(localStorage, operatorId, key), navigator.locks)
    if (!mounted.current) return
    setRecoveryKey(null); setConfirm(false); setMessage(text); setError('')
    setForm(current => ({ ...current, notes: '', quantityToRemove: 1 }))
    onSaved()
  }
  async function recover() {
    if (!recoveryKey || pending.current) return
    const key = recoveryKey
    pending.current = true; setBusy(true); setError('')
    try {
      const result = StockAdjustmentRecoverySchema.parse(await apiFetch('/api/inventory/adjustments/recover', {
        method: 'POST', body: JSON.stringify({ idempotencyKey: key }), signal: AbortSignal.timeout(20000),
      }))
      if (result.idempotency_key !== key) throw new Error('Mismatched recovery reference')
      await finish(key, result.state === 'POSTED'
        ? `The original removal is recorded once: ${result.reference_number}. Quantity removed: ${result.quantity_removed}.`
        : 'The original request is closed without a stock removal. Review current stock before starting a new request.')
    } catch {
      if (mounted.current) setError('Recovery is not confirmed. Keep this reference and retry recovery as the original operator on the original terminal. Do not submit another removal.')
    } finally { pending.current = false; if (mounted.current) setBusy(false) }
  }
  async function post() {
    if (pending.current || recoveryKey || !ready) return
    // Capture and validate once before any asynchronous work. Never reconstruct
    // a submitted request from an editable draft or persisted financial fields.
    const key = crypto.randomUUID()
    const parsed = StockAdjustmentSchema.safeParse({ ...form, lotId: form.lotId || undefined, idempotencyKey: key })
    if (!parsed.success) { setError('Review the product, quantity and adjustment notes.'); return }
    const body = JSON.stringify(parsed.data)
    pending.current = true; setBusy(true); setMessage(''); setError('')
    try {
      await withAdjustmentStorageLock(operatorId, () => savePendingAdjustment(localStorage, operatorId, key), navigator.locks)
    } catch {
      if (mounted.current) {
        setError('Another removal needs recovery or safe storage is unavailable. No new removal was submitted.')
        try { setRecoveryKey(readPendingAdjustment(localStorage, operatorId)) } catch { setReady(false) }
        setBusy(false)
      }
      pending.current = false; return
    }
    if (mounted.current) setRecoveryKey(key)
    // If navigation happened during persistence, leave the reference for recovery;
    // do not launch an unseen mutation. Recovery can safely close this unused key.
    if (!mounted.current) { pending.current = false; return }
    try {
      const result = StockAdjustmentResultSchema.parse(await apiFetch('/api/inventory/adjustments', {
        method: 'POST', body, signal: AbortSignal.timeout(20000),
      }))
      if (result.idempotency_key !== key) throw new Error('Mismatched removal reference')
      await finish(key, `${parsed.data.quantityToRemove} × ${product?.name} removed from stock. Receipt: ${result.reference_number}`)
    } catch {
      if (mounted.current) {
        setConfirm(false)
        setError('The removal result is not confirmed. Do not repeat it. Recover the original request, including after refreshing or signing in again.')
      }
    } finally { pending.current = false; if (mounted.current) setBusy(false) }
  }
  return <section className="panel">
    {recoveryKey && <div className="uncertain-result form-stack" role="alert"><h3>Resolve previous stock removal</h3><p>A previous request still needs its confirmed result. New removal is blocked until it is recovered.</p><code>{recoveryKey}</code><button type="button" className="secondary-action" disabled={busy} onClick={() => void recover()}>{busy ? 'Checking original request…' : 'Recover original removal'}</button><a href="/login?next=%2Finventory">Sign in as the original operator on this terminal</a></div>}
    {error && <p className="error-message" role="alert">{error}</p>}{message && <p className="success-message" role="status">{message}</p>}
    <form className="form-grid" onSubmit={event => { event.preventDefault(); if (!blocked && !pending.current) { setConfirm(true); setError(''); setMessage('') } }}>
      <div className="panel-heading"><div><p className="eyebrow">Inventory correction</p><h2>Remove stock</h2></div></div>
      <label className="field"><span>Product</span><select required disabled={blocked} value={form.productId} onChange={e => { set('productId', e.target.value); set('lotId', '') }}><option value="">Select product</option>{products.map(row => <option key={row.id} value={row.id}>{row.name} · {row.stock_on_hand} available</option>)}</select></label>
      <label className="field"><span>Inventory lot</span><select disabled={blocked} value={form.lotId} onChange={e => set('lotId', e.target.value)}><option value="">Use current costing order</option>{lots.filter(row => row.product_id === form.productId && row.quantity_remaining > 0).map(row => <option key={row.lot_id} value={row.lot_id}>{row.receipt_number} · {row.quantity_remaining} remaining</option>)}</select></label>
      <label className="field"><span>Quantity to remove</span><input required disabled={blocked} type="number" min={1} max={product?.stock_on_hand ?? 1} value={form.quantityToRemove} onChange={e => set('quantityToRemove', Number(e.target.value))} /></label>
      <label className="field"><span>Reason</span><select disabled={blocked} value={form.reasonCode} onChange={e => set('reasonCode', e.target.value)}><option value="DAMAGED">Damaged</option><option value="EXPIRED">Expired</option><option value="SUPPLIER_RETURN">Returned to supplier</option><option value="STOCK_COUNT_LOSS">Stock count shortage</option></select></label>
      <label className="field span-two"><span>Adjustment notes</span><textarea required disabled={blocked} minLength={3} maxLength={500} value={form.notes} onChange={e => set('notes', e.target.value)} /></label>
      <button className="secondary-action" disabled={blocked || !product || !product.stock_on_hand}>Review stock removal</button>
    </form>
    {confirm && <Dialog title="Confirm stock removal" busy={busy} onClose={() => setConfirm(false)}><p>Remove <strong>{form.quantityToRemove} × {product?.name}</strong> from saleable stock?</p><dl className="detail-list"><div><dt>Reason</dt><dd>{reasonLabels[form.reasonCode]}</dd></div><div><dt>Inventory lot</dt><dd>{selectedLot ? `${selectedLot.receipt_number} · ${selectedLot.quantity_remaining} remaining` : 'Use current costing order'}</dd></div><div><dt>Product stock after removal</dt><dd>{Math.max(0, (product?.stock_on_hand ?? 0) - form.quantityToRemove)} units, if stock has not changed</dd></div><div><dt>Notes</dt><dd>{form.notes}</dd></div></dl><p className="muted">This records the cost and quantity removed. It does not delete the product or pay a supplier refund. Current stock is checked again when you confirm.</p>{error && <p className="error-message" role="alert">{error}</p>}<div className="action-row end"><button data-dialog-initial-focus disabled={busy} className="secondary-action" onClick={() => setConfirm(false)}>Cancel</button><button disabled={blocked} className="primary-action danger-action" onClick={() => void post()}>{busy ? 'Recording adjustment…' : 'Confirm removal'}</button></div></Dialog>}
  </section>
}
