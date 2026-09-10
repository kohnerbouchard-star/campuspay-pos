import { withApiRoute } from '@/lib/api/route'
import { authorizeRequest } from '@/features/auth/server/session'
import { inventoryReport } from '@/features/reports/server'
import { failure, ok } from '@/lib/api/response'

export const dynamic = 'force-dynamic'
export const GET = withApiRoute('/api/reports/inventory', async () => {
  try { const session = await authorizeRequest('reports.inventory'); return ok(await inventoryReport(session)) }
  catch (error) { return failure(error) }
})
