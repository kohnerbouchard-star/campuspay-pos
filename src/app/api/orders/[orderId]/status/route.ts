import { withApiRoute } from '@/lib/api/route'
import { z } from 'zod'
import { authorizeRequest } from '@/features/auth/server/session'
import { UpdateOrderStatusSchema } from '@/features/store/domain'
import { updateOnlineOrderStatus } from '@/features/store/server/orders'
import { failure, ok, parseJson } from '@/lib/api/response'

export const dynamic = 'force-dynamic'
export const POST = withApiRoute('/api/orders/[orderId]/status', async (request: Request, context: { params: Promise<{ orderId: string }> }) => {
  try {
    const session = await authorizeRequest('orders.fulfill')
    const { orderId } = await context.params
    z.string().uuid().parse(orderId)
    const input = await parseJson(request, UpdateOrderStatusSchema)
    return ok(await updateOnlineOrderStatus(session, orderId, input.status))
  } catch (error) { return failure(error) }
})
