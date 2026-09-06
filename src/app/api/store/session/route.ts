import { authorizeCustomerSession } from '@/features/store/server/session'
import { failure, ok } from '@/lib/api/response'

export const dynamic = 'force-dynamic'
export async function GET() {
  try { return ok(await authorizeCustomerSession()) }
  catch (error) { return failure(error) }
}
