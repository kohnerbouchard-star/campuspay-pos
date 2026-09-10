'use client'
import { useState } from 'react'
import type { CardScanResult } from '@/features/pos/domain'
import { formatWon } from '@/lib/format/currency'
import { validSplitContribution } from '@/features/pos/tender'
export function SplitContribution({ student, total, onChoose }: { student: CardScanResult; total: number; onChoose(amount: number): void }) {
  const [amount, setAmount] = useState('')
  const maximum = student.maximum_wallet_won
  const valid = validSplitContribution(total, maximum, amount)
  return <form className="form-stack" onSubmit={event => { event.preventDefault(); if (valid) onChoose(Number(amount)) }}>
    <dl className="tender-summary">
      <div><dt>Minimum permitted balance</dt><dd>{formatWon(student.minimum_balance_won)}</dd></div>
      <div><dt>Maximum available for this purchase</dt><dd>{formatWon(maximum)}</dd></div>
    </dl>
    {maximum >= total ? <div className="notice"><p>This purchase can be paid entirely with MICA Money.</p><button type="button" className="secondary-action" onClick={() => onChoose(total)}>Switch to MICA Money</button></div> : <button type="button" className="secondary-action" disabled={maximum <= 0} onClick={() => setAmount(String(maximum))}>Use maximum MICA Money</button>}
    {maximum === 0 && <p className="notice">No MICA Money is available for this purchase. Cancel and choose Cash to continue.</p>}
    <label className="field"><span>MICA Money contribution (₩)</span><input autoFocus inputMode="numeric" value={amount} aria-describedby="split-capacity-help" onChange={event => setAmount(event.target.value.replace(/\D/g, '').slice(0, 10))} /></label>
    <p id="split-capacity-help" className={amount && !valid ? 'error-message' : 'muted'}>Choose an amount above zero, below the sale total, and no more than {formatWon(maximum)}.</p>
    {valid && <dl className="tender-summary"><div><dt>Cash remainder</dt><dd>{formatWon(total - Number(amount))}</dd></div><div><dt>Projected balance</dt><dd>{formatWon(student.current_balance_won - Number(amount))}</dd></div></dl>}
    <button className="primary-action" disabled={!valid}>Continue to cash and review</button>
  </form>
}
