import { withApiRoute } from '@/lib/api/route'
import { authorizeAnyRequest } from '@/features/auth/server/session'
import { failure, ok } from '@/lib/api/response'

export const dynamic = 'force-dynamic'
export const POST = withApiRoute('/api/auth/activity', async () => {
  try {
    const session = await authorizeAnyRequest()
    return ok({ expiresAt: session.expires_at })
  } catch (error) { return failure(error) }
})
