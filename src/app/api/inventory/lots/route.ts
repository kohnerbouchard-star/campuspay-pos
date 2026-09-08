import { withApiRoute } from '@/lib/api/route'
import { authorizeRequest } from '@/features/auth/server/session'
import { listInventoryLots } from '@/features/inventory/server'
import { failure, ok } from '@/lib/api/response'

export const dynamic = 'force-dynamic'
export const GET = withApiRoute('/api/inventory/lots', async () => {
  try { const session = await authorizeRequest('inventory.read'); return ok(await listInventoryLots(session)) }
  catch (error) { return failure(error) }
})
