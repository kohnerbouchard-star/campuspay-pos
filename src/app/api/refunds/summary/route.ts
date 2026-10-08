import { withApiRoute } from '@/lib/api/route'
import { authorizeRequest } from '@/features/auth/server/session'
import { RefundRangeSchema } from '@/features/refunds/domain'
import { refundSummary } from '@/features/refunds/server'
import { ApiError } from '@/lib/api/errors'
import { ok } from '@/lib/api/response'
export const dynamic = 'force-dynamic'
export const GET = withApiRoute('/api/refunds/summary', async (request: Request) => {
  const session = await authorizeRequest('refunds.read')
  const parsed = RefundRangeSchema.safeParse(Object.fromEntries(new URL(request.url).searchParams))
  if (!parsed.success) throw new ApiError(400, 'BAD_REQUEST', 'Choose a valid bounded date range')
  return ok(await refundSummary(session, parsed.data.from, parsed.data.to))
})
