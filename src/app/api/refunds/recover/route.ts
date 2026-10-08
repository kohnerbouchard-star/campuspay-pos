import { withApiRoute } from '@/lib/api/route'
import { authorizeRequest } from '@/features/auth/server/session'
import { RecoverRefundSchema } from '@/features/refunds/domain'
import { recoverRefund } from '@/features/refunds/server'
import { ok, parseJson } from '@/lib/api/response'
export const dynamic = 'force-dynamic'
export const POST = withApiRoute('/api/refunds/recover', async (request: Request) => {
  const session = await authorizeRequest('refunds.issue')
  const input = await parseJson(request, RecoverRefundSchema)
  return ok(await recoverRefund(session, input.saleId, input.idempotencyKey))
})
