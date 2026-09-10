import { withApiRoute } from '@/lib/api/route'
import { authorizeRequest } from '@/features/auth/server/session'
import { ScanCardSchema } from '@/features/pos/domain'
import { scanAdjustmentCard } from '@/features/wallets/server'
import { failure, ok, parseJson } from '@/lib/api/response'

export const dynamic = 'force-dynamic'
export const POST = withApiRoute('/api/accounting/intents/[intentId]/card', async (request: Request, context: { params: Promise<{ intentId: string }> }) => {
  try {
    const session = await authorizeRequest('wallet.adjust')
    const { intentId } = await context.params
    const input = await parseJson(request, ScanCardSchema)
    return ok(await scanAdjustmentCard(session, intentId, input.cardRead))
  } catch (error) { return failure(error) }
})
