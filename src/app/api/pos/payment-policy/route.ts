import { z } from 'zod'
import { ApiError } from '@/lib/api/errors'
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
    const body = await parseJson(request, z.unknown())
    const parsed = UpdatePaymentPolicySchema.safeParse(body)
    if (!parsed.success) {
      const issue = parsed.error.issues.find(item => item.code === 'custom')
      throw new ApiError(400, 'BAD_REQUEST', issue?.message ?? 'Check the payment settings: use a valid event name and a future KST end time within 24 hours.')
    }
    const input = parsed.data
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
