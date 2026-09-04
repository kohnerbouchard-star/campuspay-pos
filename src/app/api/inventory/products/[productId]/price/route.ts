import { authorizeRequest } from '@/features/auth/server/session'
import { PriceChangeSchema } from '@/features/inventory/domain'
import { changeProductPrice } from '@/features/inventory/server'
import { failure, ok, parseJson } from '@/lib/api/response'

export const dynamic = 'force-dynamic'
export async function POST(request: Request, context: { params: Promise<{ productId: string }> }) {
  try {
    const session = await authorizeRequest('inventory.price.manage')
    const { productId } = await context.params
    const input = await parseJson(request, PriceChangeSchema)
    return ok(await changeProductPrice(session, productId, input))
  } catch (error) { return failure(error) }
}
