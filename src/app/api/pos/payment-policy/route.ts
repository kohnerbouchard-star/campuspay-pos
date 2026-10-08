import { ApiError } from '@/lib/api/errors'
import { withApiRoute } from '@/lib/api/route'
import { authorizeRequest,authorizeAnyRequest } from '@/features/auth/server/session'
import { UpdatePaymentPolicySchema } from '@/features/pos/domain'
import { EVENT_PAYMENT_MESSAGES } from '@/features/pos/payment-policy-validation'
import { getPaymentPolicy, updatePaymentPolicy } from '@/features/pos/server'
import { failure, ok, parseJson } from '@/lib/api/response'
export const dynamic = 'force-dynamic'
export const GET = withApiRoute('/api/pos/payment-policy', async () => {
  try { const s=await authorizeAnyRequest();if(!s.permissions.some(p=>['pos.read','settings.payments.manage'].includes(p)))throw new ApiError(403,'FORBIDDEN','Payment policy access is not assigned');return ok(await getPaymentPolicy(s)) }
  catch (error) { return failure(error) }
})
export const POST = withApiRoute('/api/pos/payment-policy', async (request: Request) => {
  try {
    const session = await authorizeRequest('settings.payments.manage')
    const input = await parseJson(request, UpdatePaymentPolicySchema, { allowedCustomMessages: Object.values(EVENT_PAYMENT_MESSAGES) })
    try { return ok(await updatePaymentPolicy(session, input.cashEnabled, input.eventName, input.endsAt ?? null)) }
    catch (error) {
      // The database is authoritative if the end time passes in transit or the
      // browser clock is wrong. Do not weaken its 24-hour event restriction.
      if (error instanceof ApiError && error.code === 'BAD_REQUEST') {
        throw new ApiError(400, 'BAD_REQUEST', 'The register rejected these event settings. Check your device clock and choose a future KST end time within 24 hours, then reload the current settings.')
      }
      throw error
    }
  } catch (error) { return failure(error) }
})
