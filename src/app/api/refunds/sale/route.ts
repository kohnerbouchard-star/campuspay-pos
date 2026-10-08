import { z } from 'zod'
import { withApiRoute } from '@/lib/api/route'
import { authorizeRequest } from '@/features/auth/server/session'
import { refundSaleDetail } from '@/features/refunds/server'
import { ApiError } from '@/lib/api/errors'
import { ok } from '@/lib/api/response'
export const dynamic = 'force-dynamic'
export const GET = withApiRoute('/api/refunds/sale', async (request: Request) => {
  const session = await authorizeRequest('refunds.read')
  const parsed = z.string().trim().min(1).max(100).safeParse(new URL(request.url).searchParams.get('reference'))
  if (!parsed.success) throw new ApiError(400, 'BAD_REQUEST', 'Enter a receipt or order number')
  return ok(await refundSaleDetail(session, parsed.data))
})
