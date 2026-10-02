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
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [needsSignIn, setNeedsSignIn] = useState(false)
  const pending = useRef(false)
  function showError(caught: unknown) {
    setFieldErrors(Object.fromEntries((caught instanceof ClientApiError ? caught.fieldErrors : []).filter(item => ['eventName', 'endsAt'].includes(item.field)).map(item => [item.field, item.message])))
    setNeedsSignIn(caught instanceof ClientApiError && ['UNAUTHENTICATED', 'SESSION_EXPIRED'].includes(caught.code))
    setError(caught instanceof Error ? caught.message : 'Payment settings could not be confirmed. Reload the current settings before trying again.')
  }
  async function reload() {
    if (pending.current) return
    pending.current = true; setBusy(true)
    try { onChange(await fetchPaymentPolicy()); setError(''); setFieldErrors({}); setNeedsSignIn(false) }
    catch (caught) { showError(caught) }
    finally { pending.current = false; setBusy(false) }
  }
  async function save() {
    if (pending.current) return
    setFieldErrors({})
    let end: string | null = null
    if (!policy.cash_enabled) {
      try { end = businessDateTimeToIso(endsAt) }
      catch { const message = 'Choose a valid event end time in Korea Standard Time (KST).'; setError(message); setFieldErrors({ endsAt: message }); return }
      const issue = eventPaymentIssue(eventName, end)
      if (issue) { setError(issue.message); setFieldErrors({ [issue.field]: issue.message }); return }
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
        <label className="field"><span id="event-name-label">Event name</span><input aria-labelledby="event-name-label" value={eventName} required minLength={2} maxLength={80} disabled={busy} placeholder="MICA Fall Festival" aria-invalid={!!fieldErrors.eventName} aria-describedby={fieldErrors.eventName ? 'event-name-error' : undefined} onChange={event => { setEventName(event.target.value); setFieldErrors(current => ({ ...current, eventName: '' })) }} />{fieldErrors.eventName && <span id="event-name-error" className="error-message">{fieldErrors.eventName}</span>}</label>
        <label className="field"><span id="event-end-label">Automatically turn off</span><input aria-labelledby="event-end-label" type="datetime-local" required disabled={busy} value={endsAt} onChange={event => { setEndsAt(event.target.value); setFieldErrors(current => ({ ...current, endsAt: '' })) }} aria-invalid={!!fieldErrors.endsAt} aria-describedby={fieldErrors.endsAt ? 'event-end-help event-end-error' : 'event-end-help'} />{fieldErrors.endsAt && <span id="event-end-error" className="error-message">{fieldErrors.endsAt}</span>}</label>
        <p id="event-end-help" className="muted">Choose a future time within the next 24 hours, in KST—not your browser’s local timezone.</p>
        <button className="secondary-action" type="button" disabled={busy} onClick={() => { setEndsAt(businessDateTimeInput(new Date(Date.now() + 60 * 60 * 1000))); setError(''); setFieldErrors({}) }}>Set end time to one hour from now</button>
      </>}
      <button className="secondary-action" disabled={busy || needsSignIn || (!policy.cash_enabled && (eventName.trim().length < 2 || !endsAt))}>{busy ? 'Saving…' : policy.cash_enabled ? 'Turn off cash and split payments' : 'Enable event cash and split payments'}</button>
      {error && <div className="error-message" role="alert"><p>{error}</p><button type="button" disabled={busy} className="secondary-action" onClick={() => void reload()}>Reload payment settings</button>{needsSignIn && <a href="/login?expired=1&next=%2Fsettings%2Fpayments">Sign in to staff account</a>}</div>}
    </form>
  </section>
}
