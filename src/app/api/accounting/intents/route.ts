import { withApiRoute } from '@/lib/api/route'
import { authorizeRequest } from '@/features/auth/server/session'
import { CreateAdjustmentIntentSchema } from '@/features/wallets/domain'
import { createAdjustmentIntent } from '@/features/wallets/server'
import { failure, ok, parseJson } from '@/lib/api/response'

export const dynamic = 'force-dynamic'
export const POST = withApiRoute('/api/accounting/intents', async (request: Request) => {
  try {
    const session = await authorizeRequest('wallet.adjust')
    const input = await parseJson(request, CreateAdjustmentIntentSchema)
    return ok(await createAdjustmentIntent(session, input), { status: 201 })
  } catch (error) { return failure(error) }
})
