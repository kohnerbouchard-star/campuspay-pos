import { authorizeRequest } from '@/features/auth/server/session'
import { couponReport } from '@/features/reports/server'
import { failure, ok } from '@/lib/api/response'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const session = await authorizeRequest('reports.coupons')
    return ok(await couponReport(session))
  } catch (error) {
    return failure(error)
  }
}
