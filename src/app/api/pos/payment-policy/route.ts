import { withApiRoute } from '@/lib/api/route'
import { authorizeRequest } from '@/features/auth/server/session'
import { UpdatePaymentPolicySchema } from '@/features/pos/domain'
import { getPaymentPolicy, updatePaymentPolicy } from '@/features/pos/server'
import { failure, ok, parseJson } from '@/lib/api/response'
export const dynamic = 'force-dynamic'
export const GET = withApiRoute('/api/pos/payment-policy', async () => {
  try { return ok(await getPaymentPolicy(await authorizeRequest('pos.read'))) }
  catch (error) { return failure(error) }
})
export const POST = withApiRoute('/api/pos/payment-policy', async (request: Request) => {
  try {
    const session = await authorizeRequest('security.staff.manage')
    const input = await parseJson(request, UpdatePaymentPolicySchema)
    return ok(await updatePaymentPolicy(session, input.cashEnabled, input.eventName, input.endsAt ?? null))
  } catch (error) { return failure(error) }
})
