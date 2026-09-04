import { authorizeRequest } from '@/features/auth/server/session'
import { StockAdjustmentSchema } from '@/features/inventory/domain'
import { removeStock } from '@/features/inventory/server'
import { failure, ok, parseJson } from '@/lib/api/response'

export const dynamic = 'force-dynamic'
export async function POST(request: Request) {
  try {
    const session = await authorizeRequest('inventory.adjust')
    const input = await parseJson(request, StockAdjustmentSchema)
    return ok(await removeStock(session, input), { status: 201 })
  } catch (error) { return failure(error) }
}
