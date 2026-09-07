'use client'
import { useState } from 'react'
import type { PaymentPolicy } from '@/features/pos/domain'
import { savePaymentPolicy } from '@/features/pos/client'
export function PaymentPolicyPanel({ policy, onChange }: { policy: PaymentPolicy; onChange(value: PaymentPolicy): void }) {
  const [eventName, setEventName] = useState(policy.event_name ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function save() {
    if (busy) return
    setBusy(true); setError('')
    try { onChange(await savePaymentPolicy(!policy.cash_enabled, policy.cash_enabled ? null : eventName)) }
    catch (caught) { setError(caught instanceof Error ? caught.message : 'Payment settings could not be saved') }
    finally { setBusy(false) }
  }
  if (!policy.can_manage) return null
  return <details className="payment-policy"><summary>Event payment settings</summary>
    <p className="muted">Applies only to this register. Cash and split payments stay enabled here until a Super Admin turns them off.</p>
    <p>MICA Money is always available. Online Store accepts MICA Money only.</p>
    <form className="form-stack" onSubmit={event => { event.preventDefault(); void save() }}>
      {!policy.cash_enabled && <label className="field"><span>Event name</span><input value={eventName} required minLength={2} maxLength={80} placeholder="MICA Fall Festival" onChange={event => setEventName(event.target.value)} /></label>}
      <button className="secondary-action" disabled={busy || (!policy.cash_enabled && eventName.trim().length < 2)}>{busy ? 'Saving…' : policy.cash_enabled ? 'Turn off cash and split payments' : 'Enable event cash and split payments'}</button>
      {error && <p className="error-message" role="alert">{error}</p>}
    </form>
  </details>
}
