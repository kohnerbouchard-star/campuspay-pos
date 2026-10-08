import 'server-only'
import { withProductPhotos } from '@/features/product-photos/catalog'
import { z } from 'zod'
import type { SessionContext } from '@/features/auth/domain'
import {
  CatalogSchema,
  PaymentPolicySchema,
  PaymentRecoverySchema,
  type TenderMode,
  PaymentIntentSchema,
  CardScanResultSchema,
  PaymentReceiptSchema,
  PaymentDecisionSchema,
  type CartLine,
} from '@/features/pos/domain'
import { callApiRpc } from '@/lib/db/rpc'
import { ApiError } from '@/lib/api/errors'
import { fingerprintCard } from '@/lib/crypto/card-fingerprint'
import { fingerprintCouponCode } from '@/lib/crypto/coupon-code'
import { studentPinProof } from '@/lib/crypto/student-pin'

export async function getCatalog(session: SessionContext) {
  const products = await callApiRpc('catalog', { p_session_id: session.session_id }, CatalogSchema)
  return withProductPhotos(products, session.session_id)
}

export function createPaymentIntent(
  session: SessionContext,
  items: CartLine[],
  idempotencyKey: string,
  couponCode: string | null,
  tenderMode: TenderMode = 'WALLET',
  walletAmountWon: number | null = null,
) {
  return callApiRpc(
    'create_payment_intent',
    {
      p_session_id: session.session_id,
      p_items: items,
      p_tender_mode: tenderMode,
      p_wallet_amount_won: walletAmountWon,
      p_idempotency_key: idempotencyKey,
      p_coupon_code_fingerprint: couponCode ? fingerprintCouponCode(couponCode) : null,
    },
    z.array(PaymentIntentSchema).length(1).transform(([row]) => row),
  )
}

export function scanPaymentCard(session: SessionContext, intentId: string, rawCardRead: string) {
  return callApiRpc(
    'scan_payment_card',
    {
      p_session_id: session.session_id,
      p_intent_id: intentId,
      p_card_fingerprint: fingerprintCard(rawCardRead),
    },
    z.array(CardScanResultSchema).length(1).transform(([row]) => row),
  )
}

export async function confirmPayment(session: SessionContext, intentId: string, pin: string | null, cashReceivedWon: number | null = null) {
  const decision = await callApiRpc(
    'confirm_payment',
    {
      p_session_id: session.session_id,
      p_intent_id: intentId,
      p_student_pin_proof: pin ? studentPinProof(pin) : null,
      p_cash_received_won: cashReceivedWon,
    },
    z.array(PaymentDecisionSchema).length(1).transform(([row]) => row),
  )
  if (!decision.approved) {
    const code = decision.error_code ?? 'CONFLICT'
    if (code === 'INVALID_PIN') throw new ApiError(401, 'INVALID_PIN', 'PIN verification failed')
    if (code === 'RATE_LIMITED') throw new ApiError(429, 'RATE_LIMITED', 'PIN entry is temporarily locked')
    if (code === 'WALLET_LIMIT') throw new ApiError(409, 'WALLET_LIMIT', 'This purchase would exceed the −₩15,000 limit')
    if (code === 'COUPON_UNAVAILABLE') throw new ApiError(409, 'COUPON_UNAVAILABLE', 'This coupon is no longer available')
    if (code === 'COUPON_STUDENT_LIMIT') throw new ApiError(409, 'COUPON_STUDENT_LIMIT', 'This student has already used this coupon the maximum number of times')
    if (code === 'SESSION_EXPIRED') throw new ApiError(401, 'SESSION_EXPIRED', 'Payment intent expired')
    throw new ApiError(409, 'CONFLICT', 'Payment was not approved')
  }
  return PaymentReceiptSchema.parse(decision)
}

export function getPaymentPolicy(session: SessionContext) {
  return callApiRpc('terminal_payment_policy', { p_session_id: session.session_id }, z.array(PaymentPolicySchema).length(1).transform(([row]) => row))
}
export function updatePaymentPolicy(session: SessionContext, cashEnabled: boolean, eventName: string | null, endsAt: string | null) {
  return callApiRpc('set_terminal_payment_policy', { p_session_id: session.session_id, p_cash_enabled: cashEnabled, p_event_name: eventName, p_ends_at: endsAt }, z.array(PaymentPolicySchema).length(1).transform(([row]) => row))
}
export async function cancelPayment(session: SessionContext, intentId: string) {
  await callApiRpc('cancel_payment_intent', { p_session_id: session.session_id, p_intent_id: intentId }, z.unknown())
  return { cancelled: true }
}

export function recoverPayment(session: SessionContext, intentId: string) {
  return callApiRpc('recover_payment_intent', { p_session_id: session.session_id, p_intent_id: intentId }, z.array(PaymentRecoverySchema).length(1).transform(([row]) => row))
}

export function finalizePaymentTender(session: SessionContext, intentId: string, walletAmountWon: number) {
  return callApiRpc('finalize_payment_tender', { p_session_id: session.session_id, p_intent_id: intentId, p_wallet_amount_won: walletAmountWon }, z.array(PaymentIntentSchema).length(1).transform(([row]) => row))
}
