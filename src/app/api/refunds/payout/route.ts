import { withApiRoute } from '@/lib/api/route'
import { authorizeRequest } from '@/features/auth/server/session'
import { CashPayoutSchema } from '@/features/refunds/domain'
import { recordCashPayout } from '@/features/refunds/server'
import { ok, parseJson } from '@/lib/api/response'
export const dynamic = 'force-dynamic'
export const POST = withApiRoute('/api/refunds/payout', async (request: Request) => {
  const session = await authorizeRequest('refunds.cash_payout')
  const input = await parseJson(request, CashPayoutSchema)
  return ok(await recordCashPayout(session, input))
})
