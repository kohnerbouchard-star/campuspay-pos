'use client'
import { BUSINESS_TIMEZONE } from '@/lib/format/business-time'
import { useMemo, useState } from 'react'
import type { CatalogProduct } from '@/features/pos/domain'
import { calculateLandedCosts } from '@/features/inventory/costing'
import { formatWon } from '@/lib/format/currency'
import { useReceiptRecovery } from './useReceiptRecovery'
function emptyForm() {
  return { supplierName: '', supplierInvoice: '', purchaseDate: new Date().toLocaleDateString('en-CA', { timeZone: BUSINESS_TIMEZONE }), shippingWon: 0, otherCostsWon: 0, discountWon: 0, notes: '', productId: '', quantity: 1, purchaseUnitCostWon: 0, expirationDate: '' }
}
export function ReceiptForm({ products, onSaved }: { products: CatalogProduct[]; onSaved(): void }) {
  const [draft, setForm] = useState(emptyForm)
  const recovery = useReceiptRecovery(() => { setForm(emptyForm()); onSaved() })
  const stored = recovery.saved?.input, line = stored?.lines[0]
  const form = stored && line ? { supplierName: stored.supplierName, supplierInvoice: stored.supplierInvoice, purchaseDate: stored.purchaseDate, shippingWon: stored.shippingWon, otherCostsWon: stored.otherCostsWon, discountWon: stored.discountWon, notes: stored.notes ?? '', productId: line.productId, quantity: line.quantity, purchaseUnitCostWon: line.purchaseUnitCostWon, expirationDate: line.expirationDate ?? '' } : draft
  const preview = useMemo(() => {
    try { return calculateLandedCosts([{ id: 'line', quantity: form.quantity, purchaseUnitCostWon: form.purchaseUnitCostWon }], form.shippingWon, form.otherCostsWon, form.discountWon)[0] }
    catch { return null }
  }, [form.quantity, form.purchaseUnitCostWon, form.shippingWon, form.otherCostsWon, form.discountWon])
  function set<K extends keyof typeof draft>(key: K, value: (typeof draft)[K]) { setForm(current => ({ ...current, [key]: value })) }
  function submit(event: React.FormEvent) {
    event.preventDefault()
    void recovery.send({ supplierName: form.supplierName, supplierInvoice: form.supplierInvoice, purchaseDate: form.purchaseDate, shippingWon: form.shippingWon, otherCostsWon: form.otherCostsWon, discountWon: form.discountWon, notes: form.notes, lines: [{ productId: form.productId, quantity: form.quantity, purchaseUnitCostWon: form.purchaseUnitCostWon, expirationDate: form.expirationDate || null }] })
  }
  return <form className="panel form-grid" onSubmit={submit} aria-busy={recovery.busy}>
    <div className="panel-heading span-two"><div><p className="eyebrow">Stock receipt</p><h2>Receive purchased stock</h2></div><span className="status-pill">Costed receipt</span></div>
    {recovery.message && <p className="form-message span-two" role="status">{recovery.message}</p>}
    {recovery.saved && <section className="uncertain-result span-two" aria-label="Saved stock receipt" role="status">
      <strong>{recovery.confirmed ? `Receipt ${recovery.confirmed} is confirmed.` : 'Stock receipt result unknown.'}</strong>
      <p>Do not record the stock again. Check the saved request below; this only checks its status and never submits new stock.</p>
      <p>Saved request reference: <code style={{ overflowWrap: 'anywhere' }}>{recovery.saved.reference}</code></p>
      {!recovery.saved.input && <p>The old form could not be restored. Reference-only checking is still available; automatic resubmission is blocked.</p>}
      {stored && stored.lines.length > 1 && <p>This saved receipt has {stored.lines.length} lines. Only the first is shown below; an explicit retry preserves all original lines.</p>}
      <div className="action-row"><button type="button" className="primary-action" disabled={recovery.busy || !recovery.ready} onClick={() => void recovery.check()}>{recovery.busy ? 'Checking receipt…' : 'Check saved stock receipt'}</button>
        {recovery.missing && recovery.saved.input && <button type="button" className="secondary-action" disabled={recovery.busy || !recovery.ready} onClick={() => void recovery.retry()}>Retry original receipt</button>}</div>
      <p className="muted">Use the same employee account and original browser/register. Keep this tab and its site data until the result is confirmed.</p>
    </section>}
    <fieldset className="form-grid span-two" disabled={recovery.busy || !!recovery.saved || !recovery.ready}>
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
    {!recovery.saved && <button className="primary-action" disabled={recovery.busy || !recovery.ready || !form.productId || !preview}>{recovery.busy ? 'Recording…' : 'Post stock receipt'}</button>}
    {recovery.issue && <div className="error-message span-two" role="alert"><p>{recovery.issue.message}</p>
      {recovery.issue.needsSignIn && <a className="secondary-action" href="/login?expired=1&next=%2Finventory">Sign in to recover stock receipt</a>}
      {!recovery.ready && <button className="text-action" type="button" disabled={recovery.busy} onClick={recovery.reload}>Reload receipt workspace</button>}
    </div>}
  </form>
}
