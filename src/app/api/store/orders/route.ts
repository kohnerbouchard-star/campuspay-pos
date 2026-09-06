import { PlaceOnlineOrderSchema } from '@/features/store/domain'
import { createOnlineOrder, customerOrders } from '@/features/store/server/orders'
import { authorizeCustomerSession } from '@/features/store/server/session'
import { failure, ok, parseJson } from '@/lib/api/response'

export const dynamic = 'force-dynamic'
export async function GET() {
  try {
    const session = await authorizeCustomerSession()
    return ok(await customerOrders(session))
  } catch (error) { return failure(error) }
}

export async function POST(request: Request) {
  try {
    const session = await authorizeCustomerSession()
    const input = await parseJson(request, PlaceOnlineOrderSchema)
    return ok(await createOnlineOrder(session, input), { status: 201 })
  } catch (error) { return failure(error) }
}
