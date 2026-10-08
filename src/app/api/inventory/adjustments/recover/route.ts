import { withApiRoute } from '@/lib/api/route'
import { authorizeRequest } from '@/features/auth/server/session'
import { StockAdjustmentRecoveryInputSchema } from '@/features/inventory/domain'
import { recoverStockAdjustment } from '@/features/inventory/server'
import { failure, ok, parseJson } from '@/lib/api/response'

export const dynamic = 'force-dynamic'
export const POST = withApiRoute('/api/inventory/adjustments/recover', async (request: Request) => {
  try {
    const session = await authorizeRequest('inventory.adjust')
    const { idempotencyKey } = await parseJson(request, StockAdjustmentRecoveryInputSchema)
    return ok(await recoverStockAdjustment(session, idempotencyKey))
  } catch (error) { return failure(error) }
})
