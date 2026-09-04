import { authorizeRequest } from '@/features/auth/server/session'
import { salesReport } from '@/features/reports/server'
import { failure, ok } from '@/lib/api/response'

export const dynamic = 'force-dynamic'
export async function GET(request: Request) {
  try {
    const session = await authorizeRequest('reports.sales')
    const params = new URL(request.url).searchParams
    return ok(await salesReport(session, params.get('from') ?? undefined, params.get('to') ?? undefined))
  } catch (error) { return failure(error) }
}
