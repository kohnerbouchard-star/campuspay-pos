import { authorizeAnyRequest } from '@/features/auth/server/session'
import { failure, ok } from '@/lib/api/response'

export const dynamic = 'force-dynamic'
export async function POST() {
  try {
    const session = await authorizeAnyRequest()
    return ok({ expiresAt: session.expires_at })
  } catch (error) { return failure(error) }
}
