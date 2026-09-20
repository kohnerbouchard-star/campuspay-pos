import { withApiRoute } from '@/lib/api/route'
import { ok, parseJson } from '@/lib/api/response'
import { authorizeRequest } from '@/features/auth/server/session'
import { quoteInspectedRefund } from '@/features/refunds/partial-server'
import { PartialQuoteInputSchema } from '@/features/refunds/partial-domain'
export const dynamic = 'force-dynamic'
export const POST = withApiRoute('/api/refunds/items/quote', async (request: Request) => {
  const s = await authorizeRequest('reports.sales')
  return ok(await quoteInspectedRefund(s,await parseJson(request,PartialQuoteInputSchema)))
})
