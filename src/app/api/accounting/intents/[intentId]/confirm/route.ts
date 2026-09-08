import { withApiRoute } from '@/lib/api/route'
import { z } from 'zod'
import { authorizeRequest } from '@/features/auth/server/session'
import { confirmAdjustment } from '@/features/wallets/server'
import { failure, ok, parseJson } from '@/lib/api/response'

const Input = z.object({ pin: z.string().min(4).max(12).regex(/^\d+$/) })
export const dynamic = 'force-dynamic'
export const POST = withApiRoute('/api/accounting/intents/[intentId]/confirm', async (request: Request, context: { params: Promise<{ intentId: string }> }) => {
  try {
    const session = await authorizeRequest('wallet.adjust')
    const { intentId } = await context.params
    const input = await parseJson(request, Input)
    return ok(await confirmAdjustment(session, intentId, input.pin))
  } catch (error) { return failure(error) }
})
