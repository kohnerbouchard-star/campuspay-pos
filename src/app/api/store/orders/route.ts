import { withApiRoute } from '@/lib/api/route'
import { PlaceOnlineOrderSchema } from '@/features/store/domain'
import { createOnlineOrder, customerOrders } from '@/features/store/server/orders'
import { authorizeCustomerSession } from '@/features/store/server/session'
import { failure, ok, parseJson } from '@/lib/api/response'

export const dynamic = 'force-dynamic'
export const GET = withApiRoute('/api/store/orders', async () => {
  try {
    const session = await authorizeCustomerSession()
    return ok(await customerOrders(session))
  } catch (error) { return failure(error) }
})

export const POST = withApiRoute('/api/store/orders', async (request: Request) => {
  try {
    const session = await authorizeCustomerSession()
    const input = await parseJson(request, PlaceOnlineOrderSchema)
    return ok(await createOnlineOrder(session, input), { status: 201 })
  } catch (error) { return failure(error) }
})
