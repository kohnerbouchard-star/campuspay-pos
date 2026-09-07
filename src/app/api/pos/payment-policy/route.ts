import { authorizeRequest } from '@/features/auth/server/session'
import { UpdatePaymentPolicySchema } from '@/features/pos/domain'
import { getPaymentPolicy, updatePaymentPolicy } from '@/features/pos/server'
import { failure, ok, parseJson } from '@/lib/api/response'
export const dynamic = 'force-dynamic'
export async function GET() {
  try { return ok(await getPaymentPolicy(await authorizeRequest('pos.read'))) }
  catch (error) { return failure(error) }
}
export async function POST(request: Request) {
  try {
    const session = await authorizeRequest('security.staff.manage')
    const input = await parseJson(request, UpdatePaymentPolicySchema)
    return ok(await updatePaymentPolicy(session, input.cashEnabled, input.eventName))
  } catch (error) { return failure(error) }
}
