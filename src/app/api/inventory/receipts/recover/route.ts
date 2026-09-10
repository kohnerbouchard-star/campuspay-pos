import { withApiRoute } from '@/lib/api/route'
import { z } from 'zod'
import { authorizeRequest } from '@/features/auth/server/session'
import { recoverStockReceipt } from '@/features/inventory/server'
import { failure, ok, parseJson } from '@/lib/api/response'
const RecoverReceiptSchema = z.object({ idempotencyKey: z.string().uuid() })
export const dynamic = 'force-dynamic'
export const POST = withApiRoute('/api/inventory/receipts/recover', async (request: Request) => {
  try {
    const session = await authorizeRequest('inventory.receive')
    const { idempotencyKey } = await parseJson(request, RecoverReceiptSchema)
    return ok(await recoverStockReceipt(session, idempotencyKey))
  } catch (error) { return failure(error) }
})
