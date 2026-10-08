import { z } from 'zod'
import { withApiRoute } from '@/lib/api/route'
import { authorizeRequest } from '@/features/auth/server/session'
import { CashReadinessSchema } from '@/features/refunds/cash-readiness'
import { callApiRpc } from '@/lib/db/rpc'
import { ApiError } from '@/lib/api/errors'
import { ok } from '@/lib/api/response'

export const dynamic = 'force-dynamic'
export const GET = withApiRoute('/api/refunds/cash-readiness', async (request: Request) => {
  const session = await authorizeRequest('refunds.read')
  const q = new URL(request.url).searchParams
  const value = z.object({ refundId: z.string().uuid().nullable(), saleId: z.string().uuid().nullable() })
    .refine(v => Boolean(v.refundId) !== Boolean(v.saleId)).safeParse({ refundId: q.get('refundId'), saleId: q.get('saleId') })
  if (!value.success) throw new ApiError(400, 'BAD_REQUEST', 'Choose one refund or original sale.')
  const rows = await callApiRpc('refund_cash_readiness', { p_session_id: session.session_id, p_refund_id: value.data.refundId, p_sale_id: value.data.saleId },
    z.array(z.object({ result: CashReadinessSchema })).length(1))
  return ok(rows[0].result)
})
