import { authorizeRequest } from '@/features/auth/server/session'
import { searchSecurityStudents } from '@/features/security/server'
import { ApiError } from '@/lib/api/errors'
import { failure, ok } from '@/lib/api/response'

export const dynamic = 'force-dynamic'
export async function GET(request: Request) {
  try {
    const session = await authorizeRequest('security.credentials.request')
    const query = new URL(request.url).searchParams.get('q')?.trim() ?? ''
    if (query.length > 120) throw new ApiError(400, 'BAD_REQUEST', 'Search must be 120 characters or fewer')
    return ok(await searchSecurityStudents(session, query))
  } catch (error) { return failure(error) }
}
