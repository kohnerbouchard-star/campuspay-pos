'use client'

import Link from 'next/link'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { ManagedStudent } from '@/features/students/domain'
import { CompleteEnrollmentSchema, COMPLETION_MESSAGES, type CompletionDecision } from '@/features/students/completion-domain'
import { postRosterCompletion, recoverRosterCompletion } from '@/features/students/completion-client'
import { clearPendingCompletion, readPendingCompletion, savePendingCompletion } from '@/features/students/completion-storage'
import { CardReaderCapture } from '@/features/terminal/CardReaderCapture'

export function CompletionScreen({ student, enabled }: { student: ManagedStudent; enabled: boolean }) {
  const [identityVerified, setIdentityVerified] = useState(false)
  const [pin, setPin] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [reader, setReader] = useState(false)
  const [cardCaptured, setCardCaptured] = useState(false)
  const [pending, setPending] = useState<string | null>(null)
  const [ready, setReady] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<CompletionDecision | null>(null)
  const card = useRef('')
  const inFlight = useRef(false)
  const pinInput = useRef<HTMLInputElement>(null)
  useEffect(() => {
    // Defer browser-storage hydration until after mount; submission stays disabled until it finishes.
    const timer = window.setTimeout(() => {
      try { setPending(readPendingCompletion(sessionStorage, student.student_id)); setReady(true) }
      catch { setError('Recovery storage is unavailable. No enrollment can be submitted from this browser.') }
    }, 0)
    return () => { window.clearTimeout(timer); card.current = '' }
  }, [student.student_id])
  const captureCard = useCallback((value: string) => { card.current = value; setCardCaptured(true); setReader(false) }, [])
  useEffect(() => { if (cardCaptured && !reader) pinInput.current?.focus() }, [cardCaptured, reader])
  function clearCredentials() { card.current = ''; setCardCaptured(false); setPin(''); setConfirmation(''); setReader(false) }
  function acceptDecision(value: CompletionDecision) {
    if (value.outcome === 'COMPLETED' && value.student_id !== student.student_id) throw new Error('Unexpected student result')
    setResult(value)
    if (value.outcome !== 'IDEMPOTENCY_CONFLICT') {
      try { clearPendingCompletion(sessionStorage, student.student_id) }
      catch { setError('The server result is confirmed, but this browser could not clear its recovery reference. It may ask to recover the same result on your next visit.') }
      setPending(null)
      setIdentityVerified(false)
    }
  }
  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (inFlight.current || pending || !ready || !enabled || reader) return
    const requestId = crypto.randomUUID()
    const parsed = CompleteEnrollmentSchema.safeParse({
      expectedCode: student.student_code, expectedName: student.display_name,
      expectedYear: student.year_group ?? null, expectedAcademicYear: student.academic_year ?? null,
      identityVerified, cardRead: card.current, pin, confirmationPin: confirmation, idempotencyKey: requestId,
    })
    if (!parsed.success) { setError('Verify the student, scan an unused card, and enter matching 4–12 digit PINs.'); return }
    try { savePendingCompletion(sessionStorage, student.student_id, requestId) }
    catch { setError('Could not save the recovery reference. Nothing was submitted.'); return }
    inFlight.current = true; setBusy(true); setPending(requestId); setError(null); setResult(null)
    clearCredentials()
    try { acceptDecision(await postRosterCompletion(student.student_id, parsed.data)) }
    catch { setError('Enrollment result unknown. Use Recover result before attempting another issuance.') }
    finally { inFlight.current = false; setBusy(false) }
  }
  async function recover() {
    if (inFlight.current || !pending) return
    inFlight.current = true; setBusy(true); setError(null)
    try { acceptDecision(await recoverRosterCompletion(student.student_id, pending)) }
    catch { setError('Recovery could not be confirmed. Reconnect or sign in as the original operator, then return to this student. Do not issue another card.') }
    finally { inFlight.current = false; setBusy(false) }
  }
  const blockedResult = result && ['COMPLETED','ALREADY_ISSUED','INACTIVE','NOT_FOUND','STUDENT_CHANGED','IDEMPOTENCY_CONFLICT'].includes(result.outcome)
  const eligible = student.active && student.pin_set === false && !student.card_active
  return <main className="workspace">
    <header className="workspace-header"><div><p className="eyebrow">E202 · Existing roster identity</p><h1>Complete enrollment</h1><p className="muted">Issue the initial card and PIN without creating another student or changing their wallet.</p></div></header>
    <section className="panel" aria-labelledby="completion-student-heading">
      <h2 id="completion-student-heading">{student.display_name}</h2>
      <p><strong>{student.year_group ? `Y${student.year_group}` : 'Year unassigned'}</strong> · {student.student_code} · {student.academic_year ?? 'Academic year unassigned'}</p>
      <p className="muted">Verify all three identifiers against the student in front of you. Do not identify a student by name alone.</p>
      {result?.outcome === 'COMPLETED' && <div role="status"><h2>Enrollment completed</h2><p>Initial card and PIN enrollment is confirmed for this existing account. No wallet adjustment was made.</p><p>Receipt: {result.audit_reference}</p><p>Hand over the physical card only after this confirmation.</p></div>}
      {result && result.outcome !== 'COMPLETED' && <p role="alert" className="error-message">{COMPLETION_MESSAGES[result.outcome]}</p>}
      {error && <p role="alert" className="error-message">{error}</p>}
      {pending && <div className="uncertain-result" role="alert"><p>An enrollment reference remains unresolved. Recover it before starting a new request. No card number or PIN is stored for recovery.</p><button type="button" className="primary-action" disabled={busy} onClick={() => void recover()}>{busy ? 'Checking result…' : 'Recover result'}</button></div>}
      {!pending && !enabled && <p role="status">Initial roster card issuance is disabled for this installation. These students remain registered without cards or PINs.</p>}
      {!pending && !eligible && result?.outcome !== 'COMPLETED' && <p role="status">This account is not eligible for initial issuance. Review its status in the directory; existing credentials require the replacement/reset workflow.</p>}
      {!pending && enabled && eligible && !blockedResult && <form className="form-stack" onSubmit={submit} aria-busy={busy}>
        <fieldset className="form-fields" disabled={busy || !ready || reader}>
          <label className="field"><span><input type="checkbox" checked={identityVerified} onChange={event => { setIdentityVerified(event.target.checked); if (!event.target.checked) clearCredentials() }} required /> I verified the student’s name, Year, and student ID in person.</span></label>
          <button type="button" className="secondary-action" disabled={!identityVerified} onClick={() => { clearCredentials(); setReader(true); setError(null) }}>Scan unused card</button>
          {cardCaptured && <p role="status">Unused card captured for review. Not issued yet.</p>}
          <label className="field"><span>Student PIN</span><input ref={pinInput} type="password" inputMode="numeric" autoComplete="new-password" required minLength={4} maxLength={12} pattern="[0-9]{4,12}" disabled={!cardCaptured} value={pin} onChange={event => setPin(event.target.value.replace(/\D/g, '').slice(0,12))} /></label>
          <label className="field"><span>Confirm student PIN</span><input type="password" inputMode="numeric" autoComplete="new-password" required minLength={4} maxLength={12} pattern="[0-9]{4,12}" disabled={!cardCaptured} value={confirmation} onChange={event => setConfirmation(event.target.value.replace(/\D/g, '').slice(0,12))} /></label>
          <p className="muted">The student enters the PIN privately. The PIN and card input are cleared immediately upon submission. The server checks whether the scanned card is unused before issuing it.</p>
          <button className="primary-action" disabled={!identityVerified || !cardCaptured || pin.length < 4 || pin !== confirmation}>Confirm initial card and PIN</button>
        </fieldset>
        {reader && <div role="status" className="reader-state">Scan one unused card.<button type="button" className="secondary-action" onClick={() => setReader(false)}>Cancel scan</button></div>}
      </form>}
      <CardReaderCapture active={reader} onRead={captureCard} />
      <div className="action-row"><Link className="secondary-action" href="/students">Return to student directory</Link></div>
    </section>
  </main>
}
