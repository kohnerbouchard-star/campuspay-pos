import { z } from 'zod'
import { withApiRoute } from '@/lib/api/route'
import { authorizeRequest } from '@/features/auth/server/session'
import { CompleteEnrollmentSchema } from '@/features/students/completion-domain'
import { completeRosterEnrollment } from '@/features/students/completion-server'
import { ApiError } from '@/lib/api/errors'
import { failure, ok, parseJson } from '@/lib/api/response'

export const dynamic = 'force-dynamic'
export const POST = withApiRoute('/api/students/[studentId]/complete-enrollment', async (request: Request, context: { params: Promise<{ studentId: string }> }) => {
  try {
    const session = await authorizeRequest('students.enroll')
    const { studentId } = await context.params
    if (!z.string().uuid().safeParse(studentId).success) throw new ApiError(400, 'BAD_REQUEST', 'Choose a valid student account')
    return ok(await completeRosterEnrollment(session, studentId, await parseJson(request, CompleteEnrollmentSchema)))
  } catch (error) { return failure(error) }
})
