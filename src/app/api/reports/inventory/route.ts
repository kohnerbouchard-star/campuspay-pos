import { authorizeRequest } from '@/features/auth/server/session'
import { inventoryReport } from '@/features/reports/server'
import { failure, ok } from '@/lib/api/response'

export const dynamic = 'force-dynamic'
export async function GET() {
  try { const session = await authorizeRequest('reports.inventory'); return ok(await inventoryReport(session)) }
  catch (error) { return failure(error) }
}
