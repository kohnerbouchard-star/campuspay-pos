'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { SecurityStudent } from '@/features/security/domain'
import { requestStepUp, postPinReset, postCardReset } from '@/features/security/client'
import { SecurityStudentSearch } from '@/features/security/ui/SecurityStudentSearch'
import { CardReaderCapture } from '@/features/terminal/CardReaderCapture'

type Purpose = 'RESET_STUDENT_PIN' | 'RESET_STUDENT_CARD'
type Authorization = { authorizationToken: string; expiresAt: string }

export function SecurityScreen({ initialStudent }: { initialStudent?: SecurityStudent }) {
  const [student, setStudent] = useState<SecurityStudent | null>(initialStudent ?? null)
  const [purpose, setPurpose] = useState<Purpose>('RESET_STUDENT_PIN')
  const [adminCode, setAdminCode] = useState('')
  const [adminPin, setAdminPin] = useState('')
  const [authorization, setAuthorization] = useState<Authorization | null>(null)
  const [newPin, setNewPin] = useState('')
  const [confirmPin, setConfirmPin] = useState('')
  const [reader, setReader] = useState(false)
  const [cardCaptured, setCardCaptured] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const cardRead = useRef('')
  const submitting = useRef(false)

  function clearProtectedState() {
    setAuthorization(null)
    setReader(false)
    setCardCaptured(false)
    setNewPin('')
    setConfirmPin('')
    setAdminPin('')
    cardRead.current = ''
  }

  useEffect(() => {
    if (!authorization) return
    const timer = setTimeout(() => {
      setAuthorization(null)
      setReader(false)
      setCardCaptured(false)
      setNewPin('')
      setConfirmPin('')
      cardRead.current = ''
      setMessage('Authorization expired. Ask a Super Admin to authorize the action again.')
    }, Math.max(0, Date.parse(authorization.expiresAt) - Date.now()))
    return () => clearTimeout(timer)
  }, [authorization])

  async function authorize(event: React.FormEvent) {
    event.preventDefault()
    if (!student || submitting.current) return
    submitting.current = true
    setBusy(true)
    setMessage(null)
    setError(null)
    try {
      const result = await requestStepUp({ superAdminEmployeeCode: adminCode, superAdminPin: adminPin, purpose, studentId: student.student_id })
      setAuthorization(result)
      setMessage('Authorized for this student and action. Complete it within 60 seconds.')
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Authorization failed. Try again.') }
    finally { setAdminPin(''); setBusy(false); submitting.current = false }
  }

  async function completeAction(event: React.FormEvent) {
    event.preventDefault()
    if (!student || !authorization || submitting.current) return
    if (Date.parse(authorization.expiresAt) <= Date.now()) { clearProtectedState(); setError('Authorization expired. Request a fresh authorization.'); return }
    submitting.current = true
    setBusy(true)
    setMessage(null)
    setError(null)
    try {
      const result = purpose === 'RESET_STUDENT_PIN'
        ? await postPinReset(student.student_id, { authorizationToken: authorization.authorizationToken, newPin, confirmationPin: confirmPin })
        : await postCardReset(student.student_id, { authorizationToken: authorization.authorizationToken, newCardRead: cardRead.current })
      setMessage(`${purpose === 'RESET_STUDENT_PIN' ? 'Student PIN reset.' : 'Replacement card activated. The previous card is now inactive.'} Receipt: ${result.audit_reference}`)
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'The action could not be completed. Request a fresh authorization and try again.') }
    finally { clearProtectedState(); setBusy(false); submitting.current = false }
  }

  const captureCard = useCallback((value: string) => { cardRead.current = value; setReader(false); setCardCaptured(true) }, [])

  return <main className="workspace">
    <CardReaderCapture active={reader} onRead={captureCard} />
    <header className="workspace-header"><div><p className="eyebrow">Account protection</p><h1>Security</h1><p className="muted">Reset a student’s PIN or replace their MICA Money Card.</p></div><span className="status-pill">Super Admin approval required</span></header>
    <div className="dashboard-grid">
      <SecurityStudentSearch selectedId={student?.student_id} disabled={busy || reader} onSelect={(value) => { clearProtectedState(); setStudent(value); setMessage(null); setError(null) }} />
      <section className="panel" aria-labelledby="protected-action-heading" aria-busy={busy}>
        <div className="panel-heading"><div><p className="eyebrow">One student · one action</p><h2 id="protected-action-heading">PIN and card replacement</h2></div></div>
        {student ? <>
          <div className="student-summary"><strong>{student.display_name}</strong><span>{student.student_code}</span></div>
          <div className="segmented" aria-label="Protected action">{([['RESET_STUDENT_PIN', 'Reset PIN'], ['RESET_STUDENT_CARD', 'Replace card']] as const).map(([value, label]) => <button key={value} aria-pressed={purpose === value} className={purpose === value ? 'active' : ''} disabled={busy || reader} onClick={() => { clearProtectedState(); setPurpose(value); setMessage(null); setError(null) }}>{label}</button>)}</div>
          <p className="muted">{purpose === 'RESET_STUDENT_PIN' ? 'The student’s current PIN will stop working.' : 'The student’s current card will stop working when the replacement is activated.'} Active online store sessions will end.</p>
          {!authorization ? <form className="form-stack" onSubmit={authorize}>
            <label className="field"><span>Super Admin employee ID</span><input autoComplete="off" required minLength={2} maxLength={32} disabled={busy} value={adminCode} onChange={(event) => setAdminCode(event.target.value)} /></label>
            <label className="field"><span>Super Admin PIN</span><input type="password" inputMode="numeric" autoComplete="off" required minLength={4} maxLength={16} disabled={busy} value={adminPin} onChange={(event) => setAdminPin(event.target.value.replace(/\D/g, '').slice(0, 16))} /></label>
            <button className="secondary-action" disabled={busy || !adminCode || adminPin.length < 4}>{busy ? 'Authorizing…' : 'Authorize protected action'}</button>
          </form> : <form className="form-stack" onSubmit={completeAction}>
            {purpose === 'RESET_STUDENT_PIN' ? <>
              <label className="field"><span>Student enters new PIN</span><input autoFocus type="password" inputMode="numeric" autoComplete="new-password" required minLength={4} maxLength={12} pattern="[0-9]{4,12}" disabled={busy} value={newPin} onChange={(event) => setNewPin(event.target.value.replace(/\D/g, '').slice(0, 12))} /></label>
              <label className="field"><span>Student confirms new PIN</span><input type="password" inputMode="numeric" autoComplete="new-password" required minLength={4} maxLength={12} pattern="[0-9]{4,12}" disabled={busy} value={confirmPin} onChange={(event) => setConfirmPin(event.target.value.replace(/\D/g, '').slice(0, 12))} /></label>
              <p className="muted">The student should enter 4–12 digits privately.</p>
            </> : <><button type="button" className="secondary-action" disabled={busy || reader} onClick={() => setReader(true)}>{cardCaptured ? 'Scan a different card' : 'Scan replacement card'}</button>{cardCaptured && <p className="reader-state" role="status">Replacement card detected. Review the student before confirming.</p>}</>}
            {reader && <div className="reader-state" role="status"><span className="reader-dot" />Scan one replacement card.<button type="button" className="secondary-action" onClick={() => setReader(false)}>Cancel scan</button></div>}
            <div className="action-row"><button type="button" className="secondary-action" disabled={busy} onClick={clearProtectedState}>Cancel</button><button className="primary-action" disabled={busy || reader || (purpose === 'RESET_STUDENT_PIN' ? newPin.length < 4 || newPin !== confirmPin : !cardCaptured)}>{busy ? 'Completing…' : purpose === 'RESET_STUDENT_PIN' ? 'Complete PIN reset' : 'Replace active card'}</button></div>
          </form>}
        </> : <div className="empty-state"><h3>Select a student</h3><p className="muted">Search by name or student ID to begin a protected action.</p></div>}
        {message && <p className="form-message" role="status">{message}</p>}
        {error && <p className="error-message" role="alert">{error}</p>}
      </section>
    </div>
  </main>
}
