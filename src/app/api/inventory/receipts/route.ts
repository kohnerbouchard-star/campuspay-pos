import { withApiRoute } from '@/lib/api/route'
import { authorizeRequest } from '@/features/auth/server/session'
import { ReceiveStockSchema } from '@/features/inventory/domain'
import { receiveStock } from '@/features/inventory/server'
import { failure, ok, parseJson } from '@/lib/api/response'

export const dynamic = 'force-dynamic'
export const POST = withApiRoute('/api/inventory/receipts', async (request: Request) => {
  try {
    const session = await authorizeRequest('inventory.receive')
    const input = await parseJson(request, ReceiveStockSchema)
    return ok(await receiveStock(session, input), { status: 201 })
  } catch (error) { return failure(error) }
})
