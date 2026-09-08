'use client'
import { useState } from 'react'
import type { PaymentPolicy } from '@/features/pos/domain'
import { savePaymentPolicy } from '@/features/pos/client'
export function PaymentPolicyPanel({ policy, onChange }: { policy: PaymentPolicy; onChange(value: PaymentPolicy): void }) {
  const [eventName, setEventName] = useState(policy.event_name ?? '')
  const [endsAt, setEndsAt] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function save() {
    if (busy) return
    setBusy(true); setError('')
    try { onChange(await savePaymentPolicy(!policy.cash_enabled, policy.cash_enabled ? null : eventName, policy.cash_enabled ? null : new Date(endsAt).toISOString())) }
    catch (caught) { setError(caught instanceof Error ? caught.message : 'Payment settings could not be saved') }
    finally { setBusy(false) }
  }
  if (!policy.can_manage) return null
  return <section className="payment-policy">
    <h2>Event payment settings</h2>
    <p className="muted">Applies only to this register. Event cash ends automatically, within 24 hours. Times use your device’s local timezone.</p>
    <p>MICA Money is always available. Online Store accepts MICA Money only.</p>
    {policy.ends_at && <p>{policy.event_status === 'EXPIRED' ? 'Event ended' : 'Event ends'}: {new Date(policy.ends_at).toLocaleString()}</p>}
    <form className="form-stack" onSubmit={event => { event.preventDefault(); void save() }}>
      {!policy.cash_enabled && <>
        <label className="field"><span>Event name</span><input value={eventName} required minLength={2} maxLength={80} placeholder="MICA Fall Festival" onChange={event => setEventName(event.target.value)} /></label>
        <label className="field"><span>Automatically turn off</span><input type="datetime-local" required value={endsAt} onChange={event => setEndsAt(event.target.value)} aria-describedby="event-end-help" /></label>
        <p id="event-end-help" className="muted">Choose a future time within the next 24 hours.</p>
      </>}
      <button className="secondary-action" disabled={busy || (!policy.cash_enabled && (eventName.trim().length < 2 || !endsAt))}>{busy ? 'Saving…' : policy.cash_enabled ? 'Turn off cash and split payments' : 'Enable event cash and split payments'}</button>
      {error && <p className="error-message" role="alert">{error}</p>}
    </form>
  </section>
}
