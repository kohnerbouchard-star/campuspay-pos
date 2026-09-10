import { withApiRoute } from '@/lib/api/route'
import { authorizeRequest } from '@/features/auth/server/session'
import { ResetPinSchema } from '@/features/security/domain'
import { resetStudentPin } from '@/features/security/server'
import { failure, ok, parseJson } from '@/lib/api/response'
import { ApiError } from '@/lib/api/errors'
import { z } from 'zod'

export const dynamic = 'force-dynamic'
export const POST = withApiRoute('/api/security/students/[studentId]/pin-reset', async (request: Request, context: { params: Promise<{ studentId: string }> }) => {
  try {
    const session = await authorizeRequest('security.credentials.request')
    const { studentId } = await context.params
    if (!z.string().uuid().safeParse(studentId).success) throw new ApiError(400, 'BAD_REQUEST', 'Choose a valid student account')
    const input = await parseJson(request, ResetPinSchema)
    return ok(await resetStudentPin(session, studentId, input.authorizationToken, input.newPin))
  } catch (error) { return failure(error) }
})
