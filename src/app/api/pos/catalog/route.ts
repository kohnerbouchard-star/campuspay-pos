import { withApiRoute } from '@/lib/api/route'
import { authorizeRequest } from '@/features/auth/server/session'
import { getCatalog } from '@/features/pos/server'
import { failure, ok } from '@/lib/api/response'

export const dynamic = 'force-dynamic'
export const GET = withApiRoute('/api/pos/catalog', async () => {
  try { const session = await authorizeRequest('pos.read'); return ok(await getCatalog(session)) }
  catch (error) { return failure(error) }
})
