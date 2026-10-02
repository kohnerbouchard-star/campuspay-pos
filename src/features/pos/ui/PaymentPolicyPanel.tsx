'use client'
import { businessDateTimeInput, businessDateTimeToIso, formatBusinessTime } from '@/lib/format/business-time'
import { useRef, useState } from 'react'
import type { PaymentPolicy } from '@/features/pos/domain'
import { fetchPaymentPolicy, savePaymentPolicy } from '@/features/pos/client'
import { eventPaymentIssue } from '@/features/pos/payment-policy-validation'
import { ClientApiError } from '@/lib/api/client'
export function PaymentPolicyPanel({ policy, onChange }: { policy: PaymentPolicy; onChange(value: PaymentPolicy): void }) {
  const [eventName, setEventName] = useState(policy.event_name ?? '')
  const [endsAt, setEndsAt] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [needsSignIn, setNeedsSignIn] = useState(false)
  const pending = useRef(false)
  function showError(caught: unknown) {
    setNeedsSignIn(caught instanceof ClientApiError && ['UNAUTHENTICATED', 'SESSION_EXPIRED'].includes(caught.code))
    setError(caught instanceof Error ? caught.message : 'Payment settings could not be confirmed. Reload the current settings before trying again.')
  }
  async function reload() {
    if (pending.current) return
    pending.current = true; setBusy(true)
    try { onChange(await fetchPaymentPolicy()); setError(''); setNeedsSignIn(false) }
    catch (caught) { showError(caught) }
    finally { pending.current = false; setBusy(false) }
  }
  async function save() {
    if (pending.current) return
    let end: string | null = null
    if (!policy.cash_enabled) {
      try { end = businessDateTimeToIso(endsAt) }
      catch { setError('Choose a valid event end time in Korea Standard Time (KST).'); return }
      const issue = eventPaymentIssue(eventName, end)
      if (issue) { setError(issue.message); return }
    }
    pending.current = true; setBusy(true); setError(''); setNeedsSignIn(false)
    try { onChange(await savePaymentPolicy(!policy.cash_enabled, policy.cash_enabled ? null : eventName.trim(), end)) }
    catch (caught) { showError(caught) }
    finally { pending.current = false; setBusy(false) }
  }
  if (!policy.can_manage) return null
  return <section className="payment-policy">
    <h2>Event payment settings</h2>
    <p className="muted">Applies only to this register. Event cash ends automatically, within 24 hours. Enter the end time in Korea Standard Time (KST).</p>
    <p>MICA Money is always available. Online Store accepts MICA Money only.</p>
    {policy.ends_at && <p>{policy.event_status === 'EXPIRED' ? 'Event ended' : 'Event ends'}: {formatBusinessTime(policy.ends_at)} KST</p>}
    <form className="form-stack" onSubmit={event => { event.preventDefault(); void save() }}>
      {!policy.cash_enabled && <>
        <label className="field"><span>Event name</span><input value={eventName} required minLength={2} maxLength={80} disabled={busy} placeholder="MICA Fall Festival" onChange={event => setEventName(event.target.value)} /></label>
        <label className="field"><span>Automatically turn off</span><input type="datetime-local" required disabled={busy} value={endsAt} onChange={event => setEndsAt(event.target.value)} aria-describedby="event-end-help" /></label>
        <p id="event-end-help" className="muted">Choose a future time within the next 24 hours, in KST—not your browser’s local timezone.</p>
        <button className="secondary-action" type="button" disabled={busy} onClick={() => { setEndsAt(businessDateTimeInput(new Date(Date.now() + 60 * 60 * 1000))); setError('') }}>Set end time to one hour from now</button>
      </>}
      <button className="secondary-action" disabled={busy || needsSignIn || (!policy.cash_enabled && (eventName.trim().length < 2 || !endsAt))}>{busy ? 'Saving…' : policy.cash_enabled ? 'Turn off cash and split payments' : 'Enable event cash and split payments'}</button>
      {error && <div className="error-message" role="alert"><p>{error}</p><button type="button" disabled={busy} className="secondary-action" onClick={() => void reload()}>Reload payment settings</button>{needsSignIn && <a href="/login?expired=1&next=%2Fsettings%2Fpayments">Sign in to staff account</a>}</div>}
    </form>
  </section>
}
