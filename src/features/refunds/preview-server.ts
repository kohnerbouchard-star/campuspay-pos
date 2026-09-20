import 'server-only'
import { z } from 'zod'
import type { SessionContext } from '@/features/auth/domain'
import { ApiError } from '@/lib/api/errors'
import { callApiRpc } from '@/lib/db/rpc'
import { PartialRefundPreviewInputSchema, PartialRefundPreviewDecisionSchema, type PartialRefundPreviewInput } from './preview-domain'

export function partialRefundPreviewEnabled() { return process.env.PARTIAL_REFUND_PREVIEW_ENABLED === 'true' }
export function previewPartialRefund(session: SessionContext, input: PartialRefundPreviewInput) {
  if (!['super_admin', 'accountant'].includes(session.role)) throw new ApiError(403, 'FORBIDDEN', 'Financial report access is required')
  if (!partialRefundPreviewEnabled()) throw new ApiError(403, 'FORBIDDEN', 'Item-level previews are disabled for this installation')
  const value = PartialRefundPreviewInputSchema.parse(input)
  return callApiRpc('preview_partial_refund', { p_session_id: session.session_id, p_sale_id: value.saleId, p_items: value.items },
    z.array(z.object({ result: PartialRefundPreviewDecisionSchema })).length(1).transform(([r]) => r.result))
}
