import { withApiRoute } from '@/lib/api/route'
import { authorizeRequest } from '@/features/auth/server/session'
import { ApiError } from '@/lib/api/errors'
import { ok } from '@/lib/api/response'
import { inventoryProducts } from '@/features/inventory/server'

export const dynamic = 'force-dynamic'
export const GET = withApiRoute('/api/inventory/products', async () => {
  const session = await authorizeRequest('inventory.read')
  return ok(await inventoryProducts(session))
})
export const POST = withApiRoute('/api/inventory/products', async () => {
  await authorizeRequest('inventory.product.manage')
  throw new ApiError(410, 'CONFLICT', 'This product-write endpoint is retired. Use the Inventory product-management workflow so the request is reviewed and recoverable.')
})
