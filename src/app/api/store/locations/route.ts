import { deliveryLocations } from '@/features/store/server/orders'
import { failure, ok } from '@/lib/api/response'

export const dynamic = 'force-dynamic'
export async function GET() {
  try { return ok(await deliveryLocations()) }
  catch (error) { return failure(error) }
}
