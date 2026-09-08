import { withApiRoute } from '@/lib/api/route'
import { z } from 'zod'
import { authorizeRequest } from '@/features/auth/server/session'
import { recoverAdjustment } from '@/features/wallets/server'
import { failure, ok, parseJson } from '@/lib/api/response'
export const POST = withApiRoute('/api/accounting/intents/[intentId]/recover', async (request: Request, context: { params: Promise<{ intentId: string }> }) => {
  try {
    const session = await authorizeRequest('wallet.adjust')
    await parseJson(request, z.object({}).strict())
    const { intentId } = await context.params
    return ok(await recoverAdjustment(session, z.string().uuid().parse(intentId)))
  } catch (error) { return failure(error) }
})
