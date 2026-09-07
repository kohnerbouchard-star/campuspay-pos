'use client'

import { useCallback, useRef, useState } from 'react'
import type { CardScanResult, PaymentIntent, PaymentReceipt } from '@/features/pos/domain'
import { CardReaderCapture } from '@/features/terminal/CardReaderCapture'
import { cancelPaymentIntent, recoverPaymentIntent, submitCard, submitStudentPin } from '@/features/pos/client'
import { previewTender } from '@/features/pos/tender'
import { formatWon } from '@/lib/format/currency'
import { ClientApiError } from '@/lib/api/client'
import { forgetPendingPayment, rememberPendingPayment } from '@/features/pos/pending-payment'
import type { ReceiptLine } from '@/features/pos/ui/ReceiptDialog'
import { Dialog } from '@/components/ui/Dialog'

export function PaymentDialog({ intent, onClose, onComplete }: {
  intent: PaymentIntent; onClose(): void; onComplete(receipt: PaymentReceipt, items?: ReceiptLine[]): void
}) {
  const [step, setStep] = useState<'card' | 'review' | 'processing'>(intent.tender_mode === 'CASH' ? 'review' : 'card')
  const [student, setStudent] = useState<CardScanResult | null>(null)
  const [pin, setPin] = useState('')
  const [cashInput, setCashInput] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [uncertain, setUncertain] = useState(false)
  const [unavailable, setUnavailable] = useState(false)
  const pending = useRef(false)
  const tender = previewTender(intent.total_won, intent.tender_mode, String(intent.wallet_tender_won), cashInput)
  const cash = intent.tender_mode !== 'WALLET'
  const wallet = intent.tender_mode !== 'CASH'
  const valid = tender.validCash && (!wallet || pin.length >= 4)
  const quickAmounts = [5000, 10000, 20000, 50000].filter(amount => amount > intent.cash_tender_won)

  const onCard = useCallback(async (value: string) => {
    if (pending.current) return
    pending.current = true
    setStep('processing'); setError(null)
    try { setStudent(await submitCard(intent.intent_id, value)); setStep('review') }
    catch (caught) { setError(caught instanceof Error ? caught.message : 'The card could not be verified. Try again.'); setStep('card') }
    finally { pending.current = false }
  }, [intent.intent_id])

  async function close() {
    if (pending.current) return
    pending.current = true
    setStep('processing')
    try {
      if (uncertain) {
        const recovered = await recoverPaymentIntent(intent.intent_id)
        forgetPendingPayment()
        if (recovered.receipt) onComplete(recovered.receipt, recovered.items)
        else onClose()
      } else { await cancelPaymentIntent(intent.intent_id); forgetPendingPayment(); onClose() }
    }
    catch (caught) {
      if (!uncertain && caught instanceof ClientApiError && ['SESSION_EXPIRED', 'UNAUTHENTICATED'].includes(caught.code)) { forgetPendingPayment(); onClose(); return }
      setError('This payment may have completed. Sign in again on this register to recover its result before starting another sale.'); setUncertain(true); setStep('review')
    } finally { pending.current = false }
  }

  async function confirm() {
    if (pending.current || !valid || unavailable) return
    if (!rememberPendingPayment(intent.intent_id)) { setError('This browser cannot safely keep track of payments. Use another browser before taking payment.'); return }
    pending.current = true; setStep('processing'); setError(null)
    try {
      const receipt = await submitStudentPin(intent.intent_id, wallet ? pin : null, cash ? tender.cashReceivedWon : null)
      forgetPendingPayment(); setPin(''); onComplete(receipt)
    } catch (caught) {
      const knownRejection = !uncertain && caught instanceof ClientApiError && caught.status < 500
      if (knownRejection) forgetPendingPayment()
      setUncertain(!knownRejection)
      setError(knownRejection
        ? `${caught.message}. Nothing has been charged and no sale was created.`
        : 'The payment result could not be confirmed. Keep this sale open and retry to retrieve its result without charging twice.')
      if (knownRejection) setPin('')
      setUnavailable(caught instanceof ClientApiError && ['SESSION_EXPIRED', 'WALLET_LIMIT', 'COUPON_UNAVAILABLE', 'COUPON_STUDENT_LIMIT', 'PRICE_CHANGED', 'RATE_LIMITED'].includes(caught.code))
      setStep('review')
    } finally { pending.current = false }
  }

  return <Dialog title={step === 'card' ? 'Scan MICA Money Card' : step === 'processing' ? 'Completing payment…' : 'Review payment'} onClose={() => void close()} busy={step === 'processing'}>
    <CardReaderCapture active={step === 'card'} onRead={onCard} />
    <div className="payment-heading"><span>Sale total</span><strong className="payment-total">{formatWon(intent.total_won)}</strong></div>
    {intent.discount_won > 0 && <p className="payment-discount">{intent.coupon_name} · {formatWon(intent.discount_won)} saved</p>}
    {step === 'card' && <div className="reader-state" role="status"><span className="reader-dot" />Reader ready. Scan one card to continue.</div>}
    {student && <div className="student-summary">
      <strong>{student.student_display_name}</strong>
      <div><span>Current MICA Money balance</span><b>{formatWon(student.current_balance_won)}</b></div>
      <div><span>Balance after payment</span><b>{formatWon(student.projected_balance_won)}</b></div>
      {student.projected_debt_won > 0 && <div className="debt"><span>Amount owed after payment</span><b>{formatWon(student.projected_debt_won)}</b></div>}
    </div>}
    {step === 'review' && <form className="form-stack" onSubmit={event => { event.preventDefault(); void confirm() }}>
      <dl className="tender-summary">
        {wallet && <div><dt>MICA Money</dt><dd>{formatWon(intent.wallet_tender_won)}</dd></div>}
        {cash && <div><dt>Cash due</dt><dd>{formatWon(intent.cash_tender_won)}</dd></div>}
        <div className="total-row"><dt>Total settled</dt><dd>{formatWon(intent.wallet_tender_won + intent.cash_tender_won)}</dd></div>
      </dl>
      {cash && <>
        <label className="field"><span>Cash received (₩)</span><input autoFocus={intent.tender_mode === 'CASH'} inputMode="numeric" pattern="[0-9]*" value={cashInput} disabled={uncertain} aria-describedby="cash-feedback" onChange={event => setCashInput(event.target.value.replace(/\D/g, '').slice(0, 10))} /></label>
        <div className="quick-amounts"><button type="button" disabled={uncertain} onClick={() => setCashInput(String(intent.cash_tender_won))}>Exact</button>{quickAmounts.map(amount => <button key={amount} type="button" disabled={uncertain} onClick={() => setCashInput(String(amount))}>{formatWon(amount)}</button>)}</div>
        <p id="cash-feedback" className={cashInput && !tender.validCash ? 'error-message' : 'muted'} role="status">{cashInput && !tender.validCash ? `Cash received must be at least ${formatWon(intent.cash_tender_won)}.` : `Change to give: ${formatWon(tender.changeWon ?? 0)}`}</p>
      </>}
      {wallet && <label className="field"><span>Student PIN</span><input autoFocus inputMode="numeric" type="password" autoComplete="off" value={pin} onChange={event => setPin(event.target.value.replace(/\D/g, '').slice(0, 12))} /></label>}
      {error && <div className="error-message" role="alert"><strong>{uncertain ? 'Payment result unknown' : 'Payment not completed'}</strong><p>{error}</p></div>}
      <button className="primary-action" disabled={!valid || unavailable}>{uncertain ? 'Retry payment confirmation' : intent.tender_mode === 'SPLIT' ? 'Complete Split Payment' : intent.tender_mode === 'CASH' ? 'Complete Cash Payment' : 'Pay with MICA Money'}</button>
      {uncertain && <><button type="button" className="secondary-action" onClick={() => void close()}>Recover payment result</button><a href="/login?next=%2Fpos&amp;expired=1">Sign in again to recover payment</a></>}
      {!uncertain && <button type="button" className="secondary-action" onClick={() => void close()}>Adjust payment or cancel sale</button>}
    </form>}
    {step === 'card' && error && <p className="error-message" role="alert">{error}</p>}
    {step === 'processing' && <p role="status" className="muted">Please wait for the confirmed result. Keep this payment open.</p>}
  </Dialog>
}
