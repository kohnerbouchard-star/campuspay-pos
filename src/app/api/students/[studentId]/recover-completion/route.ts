import { z } from 'zod'
import { withApiRoute } from '@/lib/api/route'
import { authorizeRequest } from '@/features/auth/server/session'
import { RecoverCompletionSchema } from '@/features/students/completion-domain'
import { recoverRosterCompletion } from '@/features/students/completion-server'
import { ApiError } from '@/lib/api/errors'
import { failure, ok, parseJson } from '@/lib/api/response'

export const dynamic = 'force-dynamic'
export const POST = withApiRoute('/api/students/[studentId]/recover-completion', async (request: Request, context: { params: Promise<{ studentId: string }> }) => {
  try {
    const session = await authorizeRequest('students.read')
    const { studentId } = await context.params
    if (!z.string().uuid().safeParse(studentId).success) throw new ApiError(400, 'BAD_REQUEST', 'Choose a valid student account')
    const input = await parseJson(request, RecoverCompletionSchema)
    return ok(await recoverRosterCompletion(session, studentId, input.idempotencyKey))
  } catch (error) { return failure(error) }
})
