import { withApiRoute } from '@/lib/api/route'
import { CustomerLoginSchema } from '@/features/store/domain'
import { loginCustomerSession } from '@/features/store/server/session'
import { failure, ok, parseJson } from '@/lib/api/response'

export const dynamic = 'force-dynamic'
export const POST = withApiRoute('/api/store/login', async (request: Request) => {
  try {
    const input = await parseJson(request, CustomerLoginSchema)
    return ok(await loginCustomerSession(request, input.cardNumber, input.pin))
  } catch (error) { return failure(error) }
})
