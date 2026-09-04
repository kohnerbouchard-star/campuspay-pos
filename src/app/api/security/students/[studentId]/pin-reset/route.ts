import { authorizeRequest } from '@/features/auth/server/session'
import { ResetPinSchema } from '@/features/security/domain'
import { resetStudentPin } from '@/features/security/server'
import { failure, ok, parseJson } from '@/lib/api/response'

export const dynamic = 'force-dynamic'
export async function POST(request: Request, context: { params: Promise<{ studentId: string }> }) {
  try {
    const session = await authorizeRequest('security.credentials.request')
    const { studentId } = await context.params
    const input = await parseJson(request, ResetPinSchema)
    return ok(await resetStudentPin(session, studentId, input.authorizationToken, input.newPin))
  } catch (error) { return failure(error) }
}
