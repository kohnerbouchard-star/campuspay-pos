'use client'

import { useCallback, useState } from 'react'
import type { CardScanResult, PaymentIntent, PaymentReceipt } from '@/features/pos/domain'
import { CardReaderCapture } from '@/features/terminal/CardReaderCapture'
import { submitCard, submitStudentPin } from '@/features/pos/client'
import { formatWon } from '@/lib/format/currency'

export function PaymentDialog({ intent, onClose, onComplete }: {
  intent: PaymentIntent
  onClose(): void
  onComplete(receipt: PaymentReceipt): void
}) {
  const [step, setStep] = useState<'card'|'pin'|'processing'>('card')
  const [student, setStudent] = useState<CardScanResult | null>(null)
  const [pin, setPin] = useState('')
  const [error, setError] = useState<string | null>(null)

  const onCard = useCallback(async (value: string) => {
    if (step !== 'card') return
    setStep('processing')
    setError(null)
    try {
      const result = await submitCard(intent.intent_id, value)
      setStudent(result)
      setStep('pin')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Card could not be verified')
      setStep('card')
    }
  }, [intent.intent_id, step])

  async function confirm() {
    if (pin.length < 4) return
    setStep('processing')
    setError(null)
    try {
      const nextReceipt = await submitStudentPin(intent.intent_id, pin)
      setPin('')
      onComplete(nextReceipt)
    } catch (caught) {
      setPin('')
      setError(caught instanceof Error ? caught.message : 'Payment could not be completed')
      setStep('pin')
    }
  }

  return <div className="modal-backdrop" role="presentation">
    <CardReaderCapture active={step === 'card'} onRead={onCard} />
    <section className="modal" role="dialog" aria-modal="true" aria-labelledby="payment-title">
      <button className="modal-close" onClick={onClose} aria-label="Close">×</button>
      <p className="eyebrow">Secure student payment</p>
      <h2 id="payment-title">{step === 'card' ? 'Scan student card' : step === 'pin' ? 'Enter student PIN' : 'Processing'}</h2>
      {intent.discount_won > 0 && <div className="payment-discount">
        <span>{intent.coupon_name} · {intent.coupon_code_masked}</span>
        <b>−{formatWon(intent.discount_won)}</b>
      </div>}
      <p className="payment-total">{formatWon(intent.total_won)}</p>
      {intent.discount_won > 0 && <small className="muted">Subtotal {formatWon(intent.subtotal_won)}</small>}
      {step === 'card' && <div className="reader-state"><span className="reader-dot" />Reader active for one card</div>}
      {student && <div className="student-summary">
        <strong>{student.student_display_name}</strong>
        <div><span>Current balance</span><b>{formatWon(student.current_balance_won)}</b></div>
        <div><span>After purchase</span><b>{formatWon(student.projected_balance_won)}</b></div>
        {student.projected_debt_won > 0 && <div className="debt"><span>Amount owed</span><b>{formatWon(student.projected_debt_won)}</b></div>}
      </div>}
      {step === 'pin' && <form onSubmit={(event) => { event.preventDefault(); void confirm() }}>
        <label className="field"><span>Student PIN</span><input autoFocus inputMode="numeric" type="password" autoComplete="off" value={pin} onChange={(event) => setPin(event.target.value.replace(/\D/g, '').slice(0, 12))} /></label>
        <button className="primary-action" disabled={pin.length < 4}>Approve payment</button>
      </form>}
      {step === 'processing' && <p className="muted">Do not scan again or close the window.</p>}
      {error && <p className="error-message" role="alert">{error}</p>}
    </section>
  </div>
}
