import { QuoteOnlineOrderSchema } from '@/features/store/domain'
import { quoteOnlineOrder } from '@/features/store/server/orders'
import { authorizeCustomerSession } from '@/features/store/server/session'
import { failure, ok, parseJson } from '@/lib/api/response'

export const dynamic = 'force-dynamic'
export async function POST(request: Request) {
  try {
    const session = await authorizeCustomerSession()
    const input = await parseJson(request, QuoteOnlineOrderSchema)
    return ok(await quoteOnlineOrder(session, input))
  } catch (error) { return failure(error) }
}
