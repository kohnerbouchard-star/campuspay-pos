import { withApiRoute } from '@/lib/api/route'
import { authorizeRequest } from '@/features/auth/server/session'
import { RosterQuerySchema } from '@/features/students/domain'
import { searchRosterStudents } from '@/features/students/server'
import { ApiError } from '@/lib/api/errors'
import { failure, ok } from '@/lib/api/response'

export const dynamic = 'force-dynamic'
export const GET = withApiRoute('/api/students/roster', async (request: Request) => {
  try {
    const session = await authorizeRequest('students.read')
    const parameters = new URL(request.url).searchParams
    const rawYear = parameters.get('year')
    const rawOffset = parameters.get('offset') ?? '0'
    if ((rawYear !== null && !/^\d{1,2}$/.test(rawYear)) || !/^\d{1,7}$/.test(rawOffset)) {
      throw new ApiError(400, 'BAD_REQUEST', 'Year and page offset must be valid whole numbers')
    }
    const parsed = RosterQuerySchema.safeParse({
      query: parameters.get('q') ?? '', yearGroup: rawYear === null ? null : Number(rawYear), offset: Number(rawOffset),
    })
    if (!parsed.success) throw new ApiError(400, 'BAD_REQUEST', 'Invalid student roster search')
    return ok(await searchRosterStudents(session, parsed.data))
  } catch (error) { return failure(error) }
})
