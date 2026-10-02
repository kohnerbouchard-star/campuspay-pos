import { parseInput } from '@/lib/api/parameters'
import { withApiRoute } from '@/lib/api/route'
import { ok, parseJson } from '@/lib/api/response'
import { authorizeRequest } from '@/features/auth/server/session'
import { partialRefundSnapshot, postPartialRefund } from '@/features/refunds/partial-server'
import { PartialDirectoryQuerySchema, PostPartialRefundSchema } from '@/features/refunds/partial-domain'
export const dynamic = 'force-dynamic'
export const GET = withApiRoute('/api/refunds/items', async (request: Request) => {
  const s = await authorizeRequest('reports.sales'), q = new URL(request.url).searchParams
  const v = parseInput(PartialDirectoryQuerySchema, { reference: q.get('reference'), offset: q.get('offset') ?? 0 })
  return ok(await partialRefundSnapshot(s,v.reference,v.offset))
})
export const POST = withApiRoute('/api/refunds/items', async (request: Request) => {
  const s = await authorizeRequest('reports.sales')
  return ok(await postPartialRefund(s,await parseJson(request,PostPartialRefundSchema)))
})
