import { withApiRoute } from '@/lib/api/route'
import { authorizeAnyRequest } from '@/features/auth/server/session'
import { failure, ok } from '@/lib/api/response'

export const dynamic = 'force-dynamic'
export const GET = withApiRoute('/api/auth/session', async () => {
  try { return ok(await authorizeAnyRequest()) }
  catch (error) { return failure(error) }
})
