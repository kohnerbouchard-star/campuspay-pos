import { z } from 'zod'
import { withApiRoute } from '@/lib/api/route'
import { authorizeRequest } from '@/features/auth/server/session'
import { recoverStockAdjustment } from '@/features/inventory/server'
import { ok, parseJson } from '@/lib/api/response'
export const dynamic = 'force-dynamic'
export const POST = withApiRoute('/api/inventory/adjustments/recover', async (request: Request) => {
  const session = await authorizeRequest('inventory.adjust')
  const input = await parseJson(request, z.object({ idempotencyKey: z.string().uuid() }).strict())
  return ok(await recoverStockAdjustment(session, input.idempotencyKey))
})
