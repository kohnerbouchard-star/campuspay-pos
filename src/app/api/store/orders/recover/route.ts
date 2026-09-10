import { z } from 'zod'
import { withApiRoute } from '@/lib/api/route'
import { ok, parseJson } from '@/lib/api/response'
import { authorizeCustomerSession } from '@/features/store/server/session'
import { recoverOnlineOrder } from '@/features/store/server/orders'

export const dynamic = 'force-dynamic'
export const POST = withApiRoute('/api/store/orders/recover', async (request: Request) => {
  const session = await authorizeCustomerSession()
  const { idempotencyKey } = await parseJson(request, z.object({ idempotencyKey: z.string().uuid() }).strict())
  return ok(await recoverOnlineOrder(session, idempotencyKey))
})
