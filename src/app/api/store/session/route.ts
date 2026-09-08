import { withApiRoute } from '@/lib/api/route'
import { authorizeCustomerSession } from '@/features/store/server/session'
import { failure, ok } from '@/lib/api/response'

export const dynamic = 'force-dynamic'
export const GET = withApiRoute('/api/store/session', async () => {
  try { return ok(await authorizeCustomerSession()) }
  catch (error) { return failure(error) }
})
