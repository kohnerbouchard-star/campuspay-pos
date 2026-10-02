import { withApiRoute } from '@/lib/api/route'
import { authorizeRequest } from '@/features/auth/server/session'
import { operatorReadiness } from '@/features/readiness/server'
import { ok } from '@/lib/api/response'
export const dynamic = 'force-dynamic'
export const GET = withApiRoute('/api/settings/readiness', async () => {
  const session = await authorizeRequest('security.staff.manage')
  return ok(await operatorReadiness(session))
})
