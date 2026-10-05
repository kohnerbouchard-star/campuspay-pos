import { withApiRoute } from '@/lib/api/route'
import { ok } from '@/lib/api/response'
import { authorizeRequest } from '@/features/auth/server/session'
import { refundRecord } from '@/features/refunds/partial-server'
export const dynamic = 'force-dynamic'
export const GET = withApiRoute('/api/refunds/record', async (request: Request) => {
  const s = await authorizeRequest('refunds.read')
  return ok(await refundRecord(s,new URL(request.url).searchParams.get('refundId') ?? ''))
})
