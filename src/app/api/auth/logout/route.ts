import { withApiRoute } from '@/lib/api/route'
import { logoutStaff } from '@/features/auth/server/logout'
import { failure, ok } from '@/lib/api/response'

export const dynamic = 'force-dynamic'
export const POST = withApiRoute('/api/auth/logout', async () => {
  try { await logoutStaff(); return ok({ signedOut: true as const }) }
  catch (error) { return failure(error) }
})
