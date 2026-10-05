import { withApiRoute } from '@/lib/api/route'
import { authorizeRequest } from '@/features/auth/server/session'
import { staffOnlineOrders } from '@/features/store/server/orders'
import { failure, ok } from '@/lib/api/response'

export const dynamic = 'force-dynamic'
export const GET = withApiRoute('/api/orders', async () => {
  try {
    const session = await authorizeRequest('orders.read')
    return ok(await staffOnlineOrders(session))
  } catch (error) { return failure(error) }
})
