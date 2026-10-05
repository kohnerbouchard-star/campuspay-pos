import { withApiRoute } from '@/lib/api/route'
import { authorizeRequest } from '@/features/auth/server/session'
import { EnrollmentSchema } from '@/features/students/domain'
import { enrollStudent, searchStudents } from '@/features/students/server'
import { ApiError } from '@/lib/api/errors'
import { failure, ok, parseJson } from '@/lib/api/response'

export const dynamic = 'force-dynamic'
export const GET = withApiRoute('/api/students', async (request: Request) => {
  try {
    const session = await authorizeRequest('students.read')
    const query = new URL(request.url).searchParams.get('q')?.trim() ?? ''
    if (query.length > 120) throw new ApiError(400, 'BAD_REQUEST', 'Search must be 120 characters or fewer')
    return ok(await searchStudents(session, query))
  } catch (error) { return failure(error) }
})

export const POST = withApiRoute('/api/students', async (request: Request) => {
  try {
    const session = await authorizeRequest('students.enroll')
    const input = await parseJson(request, EnrollmentSchema)
    return ok(await enrollStudent(session, input), { status: 201 })
  } catch (error) { return failure(error) }
})
