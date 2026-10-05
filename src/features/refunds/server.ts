import 'server-only'
import { z } from 'zod'
import type { SessionContext } from '@/features/auth/domain'
import { ApiError } from '@/lib/api/errors'
import { callApiRpc } from '@/lib/db/rpc'
import { PostReturnSchema, CashPayoutSchema, PostRefundSchema, RefundDecisionSchema, RefundSaleSchema, RefundSummarySchema, type PostRefundInput } from './domain'

export function refundsEnabled() { return process.env.REFUNDS_ENABLED === 'true' }
function requireIssuer(session: SessionContext) {
  if (!session.permissions.includes('refunds.issue')) throw new ApiError(403, 'FORBIDDEN', 'Assigned employees can authorize refunds and record cash payouts')
}
const decision = z.array(z.object({ result: RefundDecisionSchema })).length(1).transform(([row]) => row.result)
export async function refundSaleDetail(session: SessionContext, reference: string) {
  const rows = await callApiRpc('refund_sale_detail', { p_session_id: session.session_id, p_reference: reference }, z.array(z.object({ result: RefundSaleSchema })).max(1))
  return rows[0]?.result ?? null
}
export function postRefund(session: SessionContext, input: PostRefundInput) {
  requireIssuer(session)
  if (!refundsEnabled()) throw new ApiError(403, 'FORBIDDEN', 'Refund posting is disabled for this installation')
  const value = PostRefundSchema.parse(input)
  return callApiRpc('post_sale_refund', { p_session_id: session.session_id, p_sale_id: value.saleId, p_reason_code: value.reasonCode,
    p_notes: value.notes, p_items: value.items, p_verified: value.verified, p_idempotency_key: value.idempotencyKey }, decision)
}
export function recoverRefund(session: SessionContext, saleId: string, key: string) {
  requireIssuer(session)
  return callApiRpc('recover_sale_refund', { p_session_id: session.session_id, p_sale_id: saleId, p_idempotency_key: key }, decision)
}
export function recordCashPayout(session: SessionContext, input: z.infer<typeof CashPayoutSchema>) {
  if (!session.permissions.includes('refunds.cash_payout')) throw new ApiError(403,'FORBIDDEN','Cash handover access is required')
  const value = CashPayoutSchema.parse(input)
  // Recording an already-authorized cash handover remains possible during a posting shutdown.
  return callApiRpc('record_refund_cash_payout', { p_session_id: session.session_id, p_refund_id: value.refundId,
    p_idempotency_key: value.idempotencyKey, p_amount_won: value.amountWon, p_handover_reference: value.handoverReference, p_confirmed: value.confirmed }, decision)
}
export async function refundSummary(session: SessionContext, from: string, to: string) {
  return callApiRpc('refund_day_summary', { p_session_id: session.session_id, p_from: from, p_to: to }, z.array(z.object({ result: RefundSummarySchema })).length(1).transform(([row]) => row.result))
}

export function returnsEnabled() { return refundsEnabled() && process.env.RETURNS_ENABLED === 'true' }
export function postReturn(session: SessionContext, input: z.infer<typeof PostReturnSchema>) {
  requireIssuer(session)
  if (!returnsEnabled()) throw new ApiError(403, 'FORBIDDEN', 'Post-dispatch returns are disabled for this installation')
  const value = PostReturnSchema.parse(input)
  return callApiRpc('post_online_return', { p_session_id: session.session_id, p_sale_id: value.saleId, p_reason_code: value.reasonCode,
    p_notes: value.notes, p_items: value.items, p_verified: value.verified, p_idempotency_key: value.idempotencyKey,
    p_return_reason: value.returnReason }, decision)
}
