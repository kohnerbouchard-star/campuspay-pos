import { withApiRoute } from '@/lib/api/route'
import { authorizeRequest } from '@/features/auth/server/session'
import { salesReport } from '@/features/reports/server'
import { failure, ok } from '@/lib/api/response'

export const dynamic = 'force-dynamic'
export const GET = withApiRoute('/api/reports/sales', async (request: Request) => {
  try {
    const session = await authorizeRequest('reports.sales')
    const params = new URL(request.url).searchParams
    return ok(await salesReport(session, params.get('from') ?? undefined, params.get('to') ?? undefined))
  } catch (error) { return failure(error) }
})
