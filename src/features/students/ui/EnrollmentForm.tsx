'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { postEnrollment } from '@/features/students/client'
import { EnrollmentSchema, type EnrollmentResult } from '@/features/students/domain'
import { CardReaderCapture } from '@/features/terminal/CardReaderCapture'
import { ClientApiError } from '@/lib/api/client'
import { formatWon } from '@/lib/format/currency'

export function EnrollmentForm({ onCancel, onComplete }: {
  onCancel(): void
  onComplete(result: EnrollmentResult): void
}) {
  const [studentCode, setStudentCode] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [pin, setPin] = useState('')
  const [confirmationPin, setConfirmationPin] = useState('')
  const [reader, setReader] = useState(false)
  const [cardCaptured, setCardCaptured] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [uncertain, setUncertain] = useState(false)
  const cardRead = useRef('')
  const idempotencyKey = useRef<string | null>(null)
  const submitting = useRef(false)
  const formRef = useRef<HTMLFormElement>(null)

  const captureCard = useCallback((value: string) => {
    cardRead.current = value
    setCardCaptured(true)
    setReader(false)
    setError(null)
  }, [])

  useEffect(() => {
    if (cardCaptured && !reader) formRef.current?.querySelector<HTMLInputElement>('input[name="studentPin"]')?.focus()
  }, [cardCaptured, reader])

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (submitting.current || reader) return
    idempotencyKey.current ??= crypto.randomUUID()
    const parsed = EnrollmentSchema.safeParse({ studentCode, displayName, cardRead: cardRead.current, pin, confirmationPin, idempotencyKey: idempotencyKey.current })
    if (!parsed.success) {
      setError(pin !== confirmationPin ? 'The PIN entries do not match.' : 'Enter a student ID and name, scan a card, and enter a matching 4–12 digit PIN.')
      return
    }
    submitting.current = true
    setBusy(true)
    setError(null)
    try {
      const result = await postEnrollment(parsed.data)
      cardRead.current = ''
      setPin('')
      setConfirmationPin('')
      setCardCaptured(false)
      onComplete(result)
    } catch (cause) {
      // Keep one key and one unchanged request after transport errors: retry cannot enroll twice.
      const definitive = !uncertain && cause instanceof ClientApiError && cause.status < 500
      if (definitive) idempotencyKey.current = null
      setUncertain(!definitive)
      setError(definitive ? `${cause.message}. No new account was created by this attempt.` : 'The enrollment result has not been confirmed.')
    } finally {
      submitting.current = false
      setBusy(false)
    }
  }

  return <section className="panel" aria-labelledby="enrollment-heading">
    <CardReaderCapture active={reader} onRead={captureCard} />
    <div className="panel-heading"><div><p className="eyebrow">E202 · Student enrollment</p><h2 id="enrollment-heading">Enroll new student</h2></div></div>
    <p className="muted">Create the student’s MICA Money account and activate their physical card.</p>
    <form ref={formRef} className="form-stack" onSubmit={submit} aria-busy={busy}>
      <fieldset disabled={busy || reader || uncertain} className="form-fields">
        <label className="field"><span>Student ID</span><input autoFocus autoComplete="off" required maxLength={40} pattern={'[A-Za-z0-9_\\-]+'} title="Use letters, numbers, hyphens or underscores" value={studentCode} onChange={(event) => setStudentCode(event.target.value)} /></label>
        <label className="field"><span>Student name</span><input autoComplete="off" required maxLength={120} value={displayName} onChange={(event) => setDisplayName(event.target.value)} /></label>
        <div className="student-summary"><span>Initial wallet balance</span><strong className="money">{formatWon(0)}</strong></div>
        <p className="muted">Add funds through Accounting after enrollment. Every top-up requires its own authorization and receipt.</p>
        <div className="field"><span>MICA Money Card</span><button type="button" className="secondary-action" onClick={() => { setReader(true); setError(null) }}>{cardCaptured ? 'Scan a different card' : 'Scan MICA Money Card'}</button></div>
        {cardCaptured && <p role="status" className="reader-state">Card detected. Ready to activate.</p>}
        <label className="field"><span>Student PIN</span><input name="studentPin" type="password" inputMode="numeric" autoComplete="new-password" required minLength={4} maxLength={12} pattern="[0-9]{4,12}" aria-describedby="enrollment-pin-help" value={pin} onChange={(event) => setPin(event.target.value.replace(/\D/g, '').slice(0, 12))} /></label>
        <p className="muted" id="enrollment-pin-help">Ask the student to enter 4–12 digits privately.</p>
        <label className="field"><span>Confirm student PIN</span><input type="password" inputMode="numeric" autoComplete="new-password" required minLength={4} maxLength={12} pattern="[0-9]{4,12}" value={confirmationPin} onChange={(event) => setConfirmationPin(event.target.value.replace(/\D/g, '').slice(0, 12))} /></label>
      </fieldset>
      {reader && <div className="reader-state" role="status"><span className="reader-dot" />Scan one card.<button type="button" className="secondary-action" onClick={() => setReader(false)}>Cancel scan</button></div>}
      {error && <p role="alert" className={uncertain ? "uncertain-result" : "error-message"}>{error}</p>}
      {uncertain && <p className="uncertain-result" role="alert"><strong>Enrollment result unknown.</strong> Do not start another enrollment until this result is recovered. Retry this unchanged request to retrieve the account safely.</p>}
      <div className="action-row">
        <button type="button" className="secondary-action" disabled={busy || uncertain} onClick={() => { cardRead.current = ''; setPin(''); setConfirmationPin(''); onCancel() }}>Cancel</button>
        <button className="primary-action" disabled={busy || reader || !cardCaptured || pin.length < 4 || pin !== confirmationPin}>{busy ? 'Creating account…' : uncertain ? 'Retry enrollment' : 'Create MICA Money account'}</button>
      </div>
    </form>
  </section>
}
