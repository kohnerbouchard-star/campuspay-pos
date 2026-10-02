import { parseInput } from '@/lib/api/parameters'
import { z } from 'zod'
import { withApiRoute } from '@/lib/api/route'
import { ok } from '@/lib/api/response'
import { authorizeCustomerSession } from '@/features/store/server/session'
import { callApiRpc } from '@/lib/db/rpc'
import { CustomerRefundsSchema } from '@/features/refunds/partial-domain'
export const dynamic = 'force-dynamic'
export const GET = withApiRoute('/api/store/orders/[orderId]/refunds', async (request: Request, context: { params: Promise<{ orderId: string }> }) => {
  const s = await authorizeCustomerSession(), { orderId } = await context.params
  const offset = parseInput(z.coerce.number().int().min(0).max(2147483597), new URL(request.url).searchParams.get('offset') ?? 0)
  const rows = await callApiRpc('customer_order_refunds', { p_customer_session_id: s.session_id, p_order_id: z.string().uuid().parse(orderId), p_offset: offset }, z.array(z.object({ result: CustomerRefundsSchema })).length(1))
  return ok(rows[0].result)
})
