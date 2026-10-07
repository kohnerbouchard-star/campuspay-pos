'use client'

import { useId, useRef, useState } from 'react'
import type { CouponQuote } from '@/features/coupons/domain'
import { formatWon } from '@/lib/format/currency'

export function CouponEntry({ applied, empty, checking, error, onApply, onRemoved }: {
  applied: { code: string; quote: CouponQuote } | null
  empty: boolean
  checking: boolean
  error: string | null
  onApply(code: string): void
  onRemoved(): void
}) {
  const inputId = useId()
  const input = useRef<HTMLInputElement>(null)
  const [code, setCode] = useState('')

  function clear() {
    onRemoved()
    setCode('')
    // The input can have been replaced by the applied-coupon summary.
    requestAnimationFrame(() => input.current?.focus())
  }

  if (applied) return <div className="coupon-applied">
    <div role="status"><small>Coupon applied</small><strong>{applied.quote.coupon_name} · {applied.quote.code_masked}</strong><span>Saving {formatWon(applied.quote.discount_won)}</span></div>
    <button type="button" className="text-action" onClick={clear} aria-label={`Remove ${applied.quote.coupon_name} coupon`}>Remove</button>
  </div>

  return <form className="coupon-entry" onSubmit={event => {
    event.preventDefault()
    if (!checking && !empty && code.trim().length >= 4) onApply(code.trim())
  }} aria-busy={checking}>
    <div className="coupon-entry-row">
      <label className="field" htmlFor={inputId}><span>Coupon code</span>
        <input ref={input} id={inputId} autoComplete="off" spellCheck={false} placeholder="Enter code" value={code}
          disabled={empty} aria-invalid={error ? true : undefined} aria-describedby={error || checking ? `${inputId}-feedback` : undefined}
          onChange={event => { onRemoved(); setCode(event.target.value.toUpperCase().slice(0, 40)) }} />
      </label>
      <button className="secondary-action" type="submit" disabled={checking || empty || code.trim().length < 4}>{checking ? 'Checking…' : 'Apply'}</button>
    </div>
    {(code || checking || error) && <button className="text-action" type="button" onClick={clear}>Clear coupon</button>}
    {checking && <p id={`${inputId}-feedback`} role="status">Checking this cart’s coupon. Payment is unavailable until it is checked or cleared.</p>}
    {error && <p className="error-message" id={`${inputId}-feedback`} role="alert">{error} Retry or clear the coupon before taking payment.</p>}
  </form>
}
