import { z } from 'zod'
import { withApiRoute } from '@/lib/api/route'
import { authorizeRequest } from '@/features/auth/server/session'
import { callApiRpc } from '@/lib/db/rpc'
import { MutationResultSchema } from '@/features/inventory/domain'
import { ok, parseJson } from '@/lib/api/response'

export const dynamic = 'force-dynamic'
export const POST = withApiRoute('/api/inventory/adjustments/recover', async (request: Request) => {
  const session = await authorizeRequest('inventory.adjust')
  const input = await parseJson(request, z.object({ idempotencyKey: z.string().uuid() }).strict())
  const rows = await callApiRpc('recover_stock_adjustment', {
    p_session_id: session.session_id, p_idempotency_key: input.idempotencyKey,
  }, z.array(MutationResultSchema).max(1))
  return ok({ adjustment: rows[0] ?? null })
})
