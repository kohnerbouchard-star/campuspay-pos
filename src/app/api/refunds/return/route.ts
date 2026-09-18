import { withApiRoute } from '@/lib/api/route'
import { authorizeRequest } from '@/features/auth/server/session'
import { PostReturnSchema } from '@/features/refunds/domain'
import { postReturn } from '@/features/refunds/server'
import { ok, parseJson } from '@/lib/api/response'
export const dynamic = 'force-dynamic'
export const POST = withApiRoute('/api/refunds/return', async (request: Request) => {
  const session = await authorizeRequest('reports.sales')
  const input = await parseJson(request, PostReturnSchema)
  return ok(await postReturn(session, input))
})
