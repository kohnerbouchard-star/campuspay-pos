import { authorizeRequest } from '@/features/auth/server/session'
import { listInventoryLots } from '@/features/inventory/server'
import { failure, ok } from '@/lib/api/response'

export const dynamic = 'force-dynamic'
export async function GET() {
  try { const session = await authorizeRequest('inventory.read'); return ok(await listInventoryLots(session)) }
  catch (error) { return failure(error) }
}
