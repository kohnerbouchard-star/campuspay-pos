'use client'

import { useState } from 'react'
import type { CouponQuote } from '@/features/coupons/domain'
import type { CartLine } from '@/features/pos/domain'
import { previewCoupon } from '@/features/coupons/client'
import { formatWon } from '@/lib/format/currency'

export function CouponEntry({
  items,
  applied,
  onApplied,
  onRemoved,
}: {
  items: CartLine[]
  applied: { code: string; quote: CouponQuote } | null
  onApplied(code: string, quote: CouponQuote): void
  onRemoved(): void
}) {
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function apply(event: React.FormEvent) {
    event.preventDefault()
    if (!code.trim() || items.length === 0) return
    setBusy(true)
    setError(null)
    try {
      const quote = await previewCoupon(items, code)
      onApplied(code, quote)
      setCode('')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Coupon could not be applied')
    } finally {
      setBusy(false)
    }
  }

  if (applied) {
    return <div className="coupon-applied">
      <div>
        <small>Coupon applied</small>
        <strong>{applied.quote.coupon_name} · {applied.quote.code_masked}</strong>
        <span>Saving {formatWon(applied.quote.discount_won)}</span>
      </div>
      <button type="button" onClick={onRemoved}>Remove</button>
    </div>
  }

  return <form className="coupon-entry" onSubmit={apply}>
    <label htmlFor="coupon-code">Coupon code</label>
    <div>
      <input
        id="coupon-code"
        autoComplete="off"
        spellCheck={false}
        placeholder="Enter code"
        value={code}
        onChange={(event) => setCode(event.target.value.toUpperCase().slice(0, 40))}
      />
      <button type="submit" disabled={busy || items.length === 0 || code.trim().length < 4}>
        {busy ? 'Checking…' : 'Apply'}
      </button>
    </div>
    {error && <small className="coupon-error" role="alert">{error}</small>}
  </form>
}
