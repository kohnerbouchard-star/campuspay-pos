import { authorizeRequest } from '@/features/auth/server/session'
import { walletReport } from '@/features/reports/server'
import { failure, ok } from '@/lib/api/response'

export const dynamic = 'force-dynamic'
export async function GET() {
  try { const session = await authorizeRequest('reports.wallets'); return ok(await walletReport(session)) }
  catch (error) { return failure(error) }
}
