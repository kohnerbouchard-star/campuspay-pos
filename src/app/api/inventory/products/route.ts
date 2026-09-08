import { withApiRoute } from '@/lib/api/route'
import { authorizeRequest } from '@/features/auth/server/session'
import { CreateProductSchema } from '@/features/inventory/domain'
import { createProduct } from '@/features/inventory/server'
import { failure, ok, parseJson } from '@/lib/api/response'
import { inventoryProducts } from '@/features/inventory/server'

export const dynamic = 'force-dynamic'
export const GET = withApiRoute('/api/inventory/products', async () => {
  try { const session = await authorizeRequest('inventory.read'); return ok(await inventoryProducts(session)) }
  catch (error) { return failure(error) }
})
export const POST = withApiRoute('/api/inventory/products', async (request: Request) => {
  try {
    const session = await authorizeRequest('inventory.product.manage')
    const input = await parseJson(request, CreateProductSchema)
    return ok(await createProduct(session, input), { status: 201 })
  } catch (error) { return failure(error) }
})
