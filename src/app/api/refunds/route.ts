import { withApiRoute } from '@/lib/api/route'
import { authorizeRequest } from '@/features/auth/server/session'
import { PostRefundSchema } from '@/features/refunds/domain'
import { postRefund } from '@/features/refunds/server'
import { ok, parseJson } from '@/lib/api/response'
export const dynamic = 'force-dynamic'
export const POST = withApiRoute('/api/refunds', async (request: Request) => {
  const session = await authorizeRequest('reports.sales')
  const input = await parseJson(request, PostRefundSchema)
  return ok(await postRefund(session, input))
})
