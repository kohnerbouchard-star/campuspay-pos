import 'server-only'
import { z } from 'zod'
import type { SessionContext } from '@/features/auth/domain'
import {
  StudentWalletSearchSchema, AdjustmentIntentSchema, AdjustmentCardResultSchema, AdjustmentReceiptSchema, AdjustmentDecisionSchema,
  type CreateAdjustmentIntentSchema,
} from '@/features/wallets/domain'
import { callApiRpc } from '@/lib/supabase/rpc'
import { fingerprintCard } from '@/lib/crypto/card-fingerprint'
import { studentPinProof } from '@/lib/crypto/student-pin'
import { ApiError } from '@/lib/api/errors'

export function searchStudentWallets(session: SessionContext, query: string) {
  return callApiRpc('search_student_wallets', { p_session_id: session.session_id, p_query: query }, StudentWalletSearchSchema)
}

export function createAdjustmentIntent(session: SessionContext, input: z.infer<typeof CreateAdjustmentIntentSchema>) {
  return callApiRpc('create_wallet_adjustment_intent', {
    p_session_id: session.session_id,
    p_direction: input.direction,
    p_denominations: input.denominations,
    p_reason_code: input.reasonCode,
    p_notes: input.notes,
    p_idempotency_key: input.idempotencyKey,
  }, z.array(AdjustmentIntentSchema).length(1).transform(([row]) => row))
}

export function scanAdjustmentCard(session: SessionContext, intentId: string, cardRead: string) {
  return callApiRpc('scan_wallet_adjustment_card', {
    p_session_id: session.session_id,
    p_intent_id: intentId,
    p_card_fingerprint: fingerprintCard(cardRead),
  }, z.array(AdjustmentCardResultSchema).length(1).transform(([row]) => row))
}

export async function confirmAdjustment(session: SessionContext, intentId: string, pin: string) {
  const decision = await callApiRpc('confirm_wallet_adjustment', {
    p_session_id: session.session_id,
    p_intent_id: intentId,
    p_student_pin_proof: studentPinProof(pin),
  }, z.array(AdjustmentDecisionSchema).length(1).transform(([row]) => row))
  if (!decision.approved) {
    const code = decision.error_code ?? 'CONFLICT'
    if (code === 'INVALID_PIN') throw new ApiError(401, 'INVALID_PIN', 'PIN verification failed')
    if (code === 'RATE_LIMITED') throw new ApiError(429, 'RATE_LIMITED', 'PIN entry is temporarily locked')
    if (code === 'WALLET_LIMIT') throw new ApiError(409, 'WALLET_LIMIT', 'Adjustment would exceed the −₩15,000 limit')
    if (code === 'SESSION_EXPIRED') throw new ApiError(401, 'SESSION_EXPIRED', 'Adjustment intent expired')
    throw new ApiError(409, 'CONFLICT', 'Adjustment was not approved')
  }
  return AdjustmentReceiptSchema.parse(decision)
}
