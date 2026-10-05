import { withApiRoute } from '@/lib/api/route'
import { ok, parseJson } from '@/lib/api/response'
import { authorizeRequest } from '@/features/auth/server/session'
import { previewPartialRefund } from '@/features/refunds/preview-server'
import { PartialRefundPreviewInputSchema } from '@/features/refunds/preview-domain'
export const dynamic = 'force-dynamic'
export const POST = withApiRoute('/api/refunds/preview', async (request: Request) => {
  const session = await authorizeRequest('refunds.read')
  const input = await parseJson(request, PartialRefundPreviewInputSchema)
  return ok(await previewPartialRefund(session, input), { headers: { 'Cache-Control': 'no-store' } })
})
