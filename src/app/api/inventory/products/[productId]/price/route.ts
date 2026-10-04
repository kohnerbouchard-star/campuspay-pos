import { withApiRoute } from '@/lib/api/route'
import { authorizeRequest } from '@/features/auth/server/session'
import { ApiError } from '@/lib/api/errors'

export const dynamic = 'force-dynamic'
export const POST = withApiRoute('/api/inventory/products/[productId]/price', async () => {
  await authorizeRequest('inventory.price.manage')
  throw new ApiError(410, 'CONFLICT', 'This price-write endpoint is retired. Use the Inventory price-change workflow so the reviewed product version and recovery key are enforced.')
})
