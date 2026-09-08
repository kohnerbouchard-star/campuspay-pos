'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import { ALLOWED_DENOMINATIONS_WON, type AdjustmentIntent, type AdjustmentCardResult } from '@/features/wallets/domain'
import { openAdjustment, scanAdjustmentCard, confirmAdjustment, recoverAdjustment } from '@/features/wallets/client'
import { pendingAdjustment, saveAdjustment, clearAdjustment } from '@/features/wallets/adjustment-recovery'
import { CardReaderCapture } from '@/features/terminal/CardReaderCapture'
import { ClientApiError } from '@/lib/api/client'
import { formatWon } from '@/lib/format/currency'

export function AdjustmentPanel({ onPosted }: { onPosted?(): void }) {
  const [recoveryReady, setRecoveryReady] = useState(false)
  const [recoveryError, setRecoveryError] = useState('')
  const [recoveryAttempt, setRecoveryAttempt] = useState(0)
  const [direction, setDirection] = useState<'CREDIT' | 'DEBIT'>('CREDIT')
  const [denominations, setDenominations] = useState<number[]>([])
  const [notes, setNotes] = useState('')
  const [intent, setIntent] = useState<AdjustmentIntent | null>(null)
  const [student, setStudent] = useState<AdjustmentCardResult | null>(null)
  const [pin, setPin] = useState('')
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [uncertain, setUncertain] = useState(false)
  const [busy, setBusy] = useState(false)
  const pending = useRef(false)
  const key = useRef<string | null>(null)
  const total = denominations.reduce((sum, value) => sum + value, 0)
  useEffect(() => {
    let active = true
    const id = pendingAdjustment()
    Promise.resolve().then(async () => {
      if (id) {
        const result = await recoverAdjustment(id)
        clearAdjustment()
        if (active) { setIntent(null); setStudent(null); setPin(''); setDenominations([]); setUncertain(false); setError(null); key.current = null }
        if (active) setMessage(result.receipt ? `Recovered ${result.receipt.reference_number}: ${formatWon(result.receipt.amount_won)} posted. Balance ${formatWon(result.receipt.balance_after_won)}.` : 'The interrupted adjustment did not post and has been cancelled.')
      }
      if (active) { setRecoveryError(''); setRecoveryReady(true) }
    }).catch(() => { if (active) setRecoveryError('An earlier adjustment needs confirmation. Sign in on this register and recover its result before starting another.') })
    return () => { active = false }
  }, [recoveryAttempt])
  async function begin() {
    if (pending.current) return
    pending.current = true; setBusy(true); setError(null); setMessage(null)
    key.current ??= crypto.randomUUID()
    try { setIntent(await openAdjustment({ direction, denominations, reasonCode: direction === 'CREDIT' ? 'FUNDS_RECEIVED' : 'OTHER_APPROVED_CORRECTION', notes, idempotencyKey: key.current })); setStudent(null) }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not start adjustment.') }
    finally { pending.current = false; setBusy(false) }
  }
  const card = useCallback(async (value: string) => {
    if (!intent || student || pending.current) return
    pending.current = true; setBusy(true); setError(null)
    try { setStudent(await scanAdjustmentCard(intent.intent_id, value)) }
    catch (e) { setError(e instanceof Error ? e.message : 'Card could not be read.') }
    finally { pending.current = false; setBusy(false) }
  }, [intent, student])
  async function finish(event: React.FormEvent) {
    event.preventDefault()
    if (!intent || pending.current) return
    if (!saveAdjustment(intent.intent_id)) { setError('This browser cannot keep track of the adjustment. Please use another browser.'); return }
    pending.current = true; setBusy(true); setError(null)
    try {
      const result = await confirmAdjustment(intent.intent_id, pin)
      clearAdjustment(); setIntent(null); setStudent(null); setDenominations([]); setUncertain(false); key.current = null
      setMessage(`${result.reference_number} · ${formatWon(result.amount_won)} posted. New balance ${formatWon(result.balance_after_won)}.`)
      onPosted?.()
    } catch (e) {
      if (!(e instanceof ClientApiError) || e.status >= 500) setUncertain(true)
      else if (!uncertain) clearAdjustment()
      setError(!uncertain && e instanceof ClientApiError && e.status < 500 ? `${e.message}. Nothing was posted to the wallet.` : 'The adjustment result has not been confirmed.')
    }
    finally { setPin(''); pending.current = false; setBusy(false) }
  }
  if (!recoveryReady) return <section className="panel form-stack" aria-label="Wallet adjustment recovery"><h2>Checking wallet adjustments</h2>{recoveryError ? <><p className="uncertain-result" role="alert">{recoveryError}</p><button className="secondary-action" onClick={() => setRecoveryAttempt(value => value + 1)}>Recover adjustment</button></> : <p role="status">Checking the previous transaction…</p>}</section>
  return <section className="panel form-stack" aria-busy={busy}>
    <CardReaderCapture active={Boolean(intent && !student && !busy)} onRead={card} />
    <div className="panel-heading"><div><p className="eyebrow">Student funds</p><h2>Add or deduct funds</h2></div><span className="status-pill">Card + PIN required</span></div>
    <p className="muted">Record money received or an approved correction. Confirm the student and amount before posting.</p>
    {!intent && <><div className="segmented"><button disabled={busy} aria-pressed={direction === 'CREDIT'} className={direction === 'CREDIT' ? 'active' : ''} onClick={() => { setDirection('CREDIT'); setDenominations([]); key.current = null }}>Add funds</button><button disabled={busy} aria-pressed={direction === 'DEBIT'} className={direction === 'DEBIT' ? 'active' : ''} onClick={() => { setDirection('DEBIT'); setDenominations([]); key.current = null }}>Approved deduction</button></div>
      <div className="denominations">{ALLOWED_DENOMINATIONS_WON.map(value => <button key={value} disabled={busy || denominations.length >= 30} onClick={() => { setDenominations(current => [...current, value]); key.current = null }}>+ {formatWon(value)}</button>)}</div></>}
    <div className="selected-total"><span>{direction === 'CREDIT' ? 'Add to wallet' : 'Deduct from wallet'}</span><strong>{formatWon(total)}</strong>{!intent && <button disabled={busy || !denominations.length} onClick={() => { setDenominations(current => current.slice(0, -1)); key.current = null }}>Undo last</button>}</div>
    <label className="field"><span>Reason / notes</span><input required minLength={3} maxLength={500} disabled={busy || Boolean(intent)} value={notes} onChange={e => { setNotes(e.target.value); key.current = null }} /></label>
    {!intent && <button className="primary-action" disabled={busy || !denominations.length || notes.trim().length < 3} onClick={() => void begin()}>{busy ? 'Preparing…' : 'Scan student card'}</button>}
    {intent && !student && <div className="reader-state" role="status"><span className="reader-dot" />{busy ? 'Checking card…' : 'Reader ready. Scan one MICA Money Card.'}</div>}
    {student && <form className="form-stack" onSubmit={finish}><div className="student-summary"><strong>{student.student_display_name}</strong><div><span>Current balance</span><b>{formatWon(student.current_balance_won)}</b></div><div><span>Balance after this transaction</span><b>{formatWon(student.projected_balance_won)}</b></div></div><label className="field"><span>Student PIN</span><input required autoFocus type="password" inputMode="numeric" autoComplete="off" disabled={busy} value={pin} onChange={e => setPin(e.target.value.replace(/\D/g, '').slice(0, 12))} /></label><button className="primary-action" disabled={busy || pin.length < 4}>{busy ? 'Posting transaction…' : `Confirm ${direction === 'CREDIT' ? 'addition' : 'deduction'} of ${formatWon(total)}`}</button></form>}
    {uncertain && <div className="uncertain-result" role="alert"><p><strong>Adjustment result unknown.</strong> Do not start another adjustment until this result is recovered.</p><button className="secondary-action" disabled={busy} onClick={() => { setRecoveryReady(false); setRecoveryAttempt(value => value + 1) }}>Recover adjustment result</button></div>}
    {intent && !busy && !uncertain && <button className="secondary-action" onClick={() => { setIntent(null); setStudent(null); setPin(''); key.current = null; setError(null) }}>Cancel verification</button>}
    {error && <p className={uncertain ? "uncertain-result" : "error-message"} role="alert">{error}</p>}{message && <p className="success-message" role="status">{message}</p>}
  </section>
}
