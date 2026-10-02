import { withApiRoute } from '@/lib/api/route'
import { authorizeRequest } from '@/features/auth/server/session'
import { CompleteMissingPinSchema } from '@/features/security/domain'
import { completeMissingStudentPin } from '@/features/security/server'
import { ok, parseJson } from '@/lib/api/response'
export const dynamic = 'force-dynamic'
export const POST = withApiRoute('/api/security/students/[studentId]/complete-pin', async (request: Request, context: { params: Promise<{ studentId: string }> }) => {
  const session = await authorizeRequest('students.manage')
  const { studentId } = await context.params
  const input = await parseJson(request, CompleteMissingPinSchema)
  return ok(await completeMissingStudentPin(session, studentId, input.authorizationToken, input.newPin, input.identityVerified))
})
