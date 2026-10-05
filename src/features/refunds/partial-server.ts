import 'server-only'
import { z } from 'zod'
import { ApiError } from '@/lib/api/errors'
import { callApiRpc } from '@/lib/db/rpc'
import type { SessionContext } from '@/features/auth/domain'
import { refundsEnabled, returnsEnabled } from './server'
import { RefundDecisionSchema, RefundRecordSchema } from './domain'
import { PartialDirectoryQuerySchema, PartialSnapshotSchema, PartialQuoteInputSchema, PartialQuoteDecisionSchema, PostPartialRefundSchema, type PostPartialRefundInput } from './partial-domain'
export function partialRefundsEnabled() { return refundsEnabled() && process.env.PARTIAL_REFUNDS_ENABLED === 'true' }
export async function partialRefundSnapshot(s: SessionContext, reference: string, offset: number) {
  const q = PartialDirectoryQuerySchema.parse({ reference, offset })
  const rows = await callApiRpc('partial_refund_snapshot', { p_session_id: s.session_id, p_reference: q.reference, p_offset: q.offset }, z.array(z.object({ result: PartialSnapshotSchema })).max(1))
  return rows[0]?.result ?? null
}
export function quoteInspectedRefund(s: SessionContext, input: z.infer<typeof PartialQuoteInputSchema>) {
  if (!partialRefundsEnabled()) throw new ApiError(409,'CONFLICT','Item-level refunds are disabled for this installation')
  const v = PartialQuoteInputSchema.parse(input)
  return callApiRpc('quote_partial_refund', { p_session_id: s.session_id, p_sale_id: v.saleId, p_items: v.items }, z.array(z.object({ result: PartialQuoteDecisionSchema })).length(1).transform(([r]) => r.result))
}
export function postPartialRefund(s: SessionContext, input: PostPartialRefundInput) {
  if (!s.permissions.includes('refunds.issue')) throw new ApiError(403,'FORBIDDEN','Assigned employees can authorize item-level refunds')
  if (!partialRefundsEnabled() || (input.returnReason && !returnsEnabled())) throw new ApiError(409,'CONFLICT','Item-level refund or return posting is disabled')
  const v = PostPartialRefundSchema.parse(input)
  return callApiRpc('post_partial_refund', { p_session_id: s.session_id, p_sale_id: v.saleId, p_key: v.idempotencyKey, p_items: v.items,
    p_expected_count: v.expectedRefundCount, p_reason_code: v.reasonCode, p_notes: v.notes, p_verified: v.verified, p_return_reason: v.returnReason ?? null },
  z.array(z.object({ result: RefundDecisionSchema })).length(1).transform(([r]) => r.result))
}
export async function refundRecord(s: SessionContext, refundId: string) {
  const rows = await callApiRpc('refund_record', { p_session_id: s.session_id, p_refund_id: z.string().uuid().parse(refundId) }, z.array(z.object({ result: RefundRecordSchema })).max(1))
  if (!rows[0]) throw new ApiError(404,'NOT_FOUND','Refund receipt not found')
  return rows[0].result
}
