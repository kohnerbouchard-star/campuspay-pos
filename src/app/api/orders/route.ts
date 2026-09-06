import { authorizeRequest } from '@/features/auth/server/session'
import { staffOnlineOrders } from '@/features/store/server/orders'
import { failure, ok } from '@/lib/api/response'

export const dynamic = 'force-dynamic'
export async function GET() {
  try {
    const session = await authorizeRequest('orders.fulfill')
    return ok(await staffOnlineOrders(session))
  } catch (error) { return failure(error) }
}
