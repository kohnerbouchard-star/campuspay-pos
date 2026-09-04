'use client'

import { useState } from 'react'
import { addCoupon } from '@/features/coupons/client'
import { formatWon } from '@/lib/format/currency'

function generateCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  const bytes = new Uint8Array(10)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (value) => alphabet[value % alphabet.length]).join('')
}

function toNumberOrNull(value: string): number | null {
  if (value.trim() === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

export function CouponForm({ onSaved }: { onSaved(): void }) {
  const now = new Date()
  now.setSeconds(0, 0)
  const [form, setForm] = useState({
    name: '',
    code: '',
    discountType: 'FIXED' as 'FIXED' | 'PERCENTAGE',
    fixedAmountWon: '1000',
    percentage: '10',
    minimumSubtotalWon: '0',
    maxDiscountWon: '',
    totalRedemptionLimit: '',
    perStudentLimit: '1',
    startsAt: now.toISOString().slice(0, 16),
    endsAt: '',
  })
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  function set<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((current) => ({ ...current, [key]: value }))
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setBusy(true)
    setMessage(null)
    try {
      const result = await addCoupon({
        name: form.name,
        code: form.code,
        discountType: form.discountType,
        fixedAmountWon: form.discountType === 'FIXED' ? toNumberOrNull(form.fixedAmountWon) : null,
        percentageBps: form.discountType === 'PERCENTAGE'
          ? Math.round((toNumberOrNull(form.percentage) ?? 0) * 100)
          : null,
        minimumSubtotalWon: toNumberOrNull(form.minimumSubtotalWon) ?? 0,
        maxDiscountWon: toNumberOrNull(form.maxDiscountWon),
        totalRedemptionLimit: toNumberOrNull(form.totalRedemptionLimit),
        perStudentLimit: toNumberOrNull(form.perStudentLimit),
        startsAt: new Date(form.startsAt).toISOString(),
        endsAt: form.endsAt ? new Date(form.endsAt).toISOString() : null,
      })
      setMessage(`Created ${result.name} (${result.code_masked}). The full code is not retrievable after this screen is cleared.`)
      setForm((current) => ({ ...current, name: '', code: '' }))
      onSaved()
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : 'Coupon could not be created')
    } finally {
      setBusy(false)
    }
  }

  return <form className="panel form-grid" onSubmit={submit}>
    <div className="panel-heading span-two">
      <div><p className="eyebrow">Controlled promotion</p><h2>Create coupon</h2></div>
      <span className="status-pill">One code per sale</span>
    </div>
    <label className="field span-two"><span>Coupon name</span><input required minLength={2} maxLength={120} value={form.name} onChange={(event) => set('name', event.target.value)} /></label>
    <label className="field"><span>Coupon code</span><input required minLength={4} maxLength={40} autoComplete="off" spellCheck={false} value={form.code} onChange={(event) => set('code', event.target.value.toUpperCase())} /></label>
    <button className="secondary-action coupon-generate" type="button" onClick={() => set('code', generateCode())}>Generate code</button>
    <label className="field"><span>Discount type</span><select value={form.discountType} onChange={(event) => set('discountType', event.target.value as 'FIXED' | 'PERCENTAGE')}><option value="FIXED">Fixed amount</option><option value="PERCENTAGE">Percentage</option></select></label>
    {form.discountType === 'FIXED'
      ? <label className="field"><span>Discount amount (₩)</span><input type="number" min="1" required value={form.fixedAmountWon} onChange={(event) => set('fixedAmountWon', event.target.value)} /></label>
      : <label className="field"><span>Discount percentage</span><input type="number" min="0.01" max="100" step="0.01" required value={form.percentage} onChange={(event) => set('percentage', event.target.value)} /></label>}
    <label className="field"><span>Minimum order (₩)</span><input type="number" min="0" value={form.minimumSubtotalWon} onChange={(event) => set('minimumSubtotalWon', event.target.value)} /></label>
    <label className="field"><span>Maximum discount (₩, optional)</span><input type="number" min="1" value={form.maxDiscountWon} onChange={(event) => set('maxDiscountWon', event.target.value)} /></label>
    <label className="field"><span>Total use limit (optional)</span><input type="number" min="1" value={form.totalRedemptionLimit} onChange={(event) => set('totalRedemptionLimit', event.target.value)} /></label>
    <label className="field"><span>Uses per student (optional)</span><input type="number" min="1" value={form.perStudentLimit} onChange={(event) => set('perStudentLimit', event.target.value)} /></label>
    <label className="field"><span>Starts</span><input type="datetime-local" required value={form.startsAt} onChange={(event) => set('startsAt', event.target.value)} /></label>
    <label className="field"><span>Ends (optional)</span><input type="datetime-local" value={form.endsAt} onChange={(event) => set('endsAt', event.target.value)} /></label>
    <div className="coupon-preview span-two">
      <span>Preview</span>
      <strong>{form.discountType === 'FIXED' ? formatWon(toNumberOrNull(form.fixedAmountWon) ?? 0) : `${form.percentage || '0'}%`} off</strong>
      <small>Code values are stored only as keyed fingerprints. Existing coupon terms are immutable; deactivate and create a replacement to change them.</small>
    </div>
    <button className="primary-action" disabled={busy || form.code.trim().length < 4 || form.name.trim().length < 2}>{busy ? 'Creating…' : 'Create coupon'}</button>
    {message && <p className="form-message span-two" role="status">{message}</p>}
  </form>
}
