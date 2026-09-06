import { CustomerLoginSchema } from '@/features/store/domain'
import { loginCustomerSession } from '@/features/store/server/session'
import { failure, ok, parseJson } from '@/lib/api/response'

export const dynamic = 'force-dynamic'
export async function POST(request: Request) {
  try {
    const input = await parseJson(request, CustomerLoginSchema)
    return ok(await loginCustomerSession(request, input.cardNumber, input.pin))
  } catch (error) { return failure(error) }
}
