'use client'

import { businessDateTimeInput, businessDateTimeToIso } from '@/lib/format/business-time'
import { useRef, useState } from 'react'
import { addCoupon } from '@/features/coupons/client'
import { formatWon } from '@/lib/format/currency'
import { ClientApiError } from '@/lib/api/client'

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
    startsAt: businessDateTimeInput(now),
    endsAt: '',
  })
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [created, setCreated] = useState<{ name: string; code: string } | null>(null)
  const [uncertain, setUncertain] = useState(false)
  const pending = useRef(false)
  const requestKey = useRef<string | null>(null)

  function set<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    requestKey.current = null
    setForm((current) => ({ ...current, [key]: value }))
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (pending.current) return
    pending.current = true
    requestKey.current ??= crypto.randomUUID()
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
        startsAt: businessDateTimeToIso(form.startsAt),
        endsAt: form.endsAt ? businessDateTimeToIso(form.endsAt) : null,
      }, requestKey.current)
      setCreated({ name: result.name, code: form.code })
      setMessage(null); setUncertain(false); requestKey.current = null
      setForm((current) => ({ ...current, name: '', code: '' }))
      onSaved()
    } catch (caught) {
      if (!(caught instanceof ClientApiError) || caught.outcome === 'unknown' || caught.status >= 500) setUncertain(true)
      setMessage(caught instanceof Error ? caught.message : 'Coupon could not be created')
    } finally {
      pending.current = false
      setBusy(false)
    }
  }

  if (created) return <section className="panel form-stack"><div><p className="eyebrow">Promotion created</p><h2>{created.name}</h2></div><p className="success-message" role="status">Your coupon is ready to share. Save the full code before closing this confirmation.</p><label className="field"><span>Full coupon code</span><input readOnly value={created.code} onFocus={event => event.target.select()} /></label><p className="muted">Only a masked version is available later in the coupon register.</p><button className="primary-action" onClick={() => setCreated(null)}>I’ve saved the code · Create another</button></section>

  return <form className="panel form-grid" onSubmit={submit} aria-busy={busy}>
    <div className="panel-heading span-two">
      <div><p className="eyebrow">Controlled promotion</p><h2>Create coupon</h2></div>
      <span className="status-pill">One code per sale</span>
    </div>
    <fieldset className="form-grid span-two" disabled={busy || uncertain}>
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
    <label className="field"><span>Starts · KST</span><input type="datetime-local" required value={form.startsAt} onChange={(event) => set('startsAt', event.target.value)} /></label>
    <label className="field"><span>Ends · KST (optional)</span><input type="datetime-local" value={form.endsAt} onChange={(event) => set('endsAt', event.target.value)} /></label>
    <div className="coupon-preview span-two">
      <span>Preview</span>
      <strong>{form.discountType === 'FIXED' ? formatWon(toNumberOrNull(form.fixedAmountWon) ?? 0) : `${form.percentage || '0'}%`} off</strong>
      <small>Save the full code before creating the coupon. To change its terms later, deactivate it and create a replacement.</small>
    </div>
    </fieldset>
    {uncertain && <p className="notice span-two" role="status">The result is not confirmed. Retry this same coupon to check its result before creating another.</p>}
    <button className="primary-action" disabled={busy || form.code.trim().length < 4 || form.name.trim().length < 2}>{busy ? 'Creating…' : uncertain ? 'Retry same coupon' : 'Create coupon'}</button>
    {message && <p className="error-message span-two" role="alert">{message}</p>}
  </form>
}
