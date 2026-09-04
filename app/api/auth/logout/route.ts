import { logoutStaff } from '@/features/auth/server/logout'
import { failure, ok } from '@/lib/api/response'

export const dynamic = 'force-dynamic'
export async function POST() {
  try { await logoutStaff(); return ok({ signedOut: true as const }) }
  catch (error) { return failure(error) }
}
