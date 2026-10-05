import { withApiRoute } from '@/lib/api/route'
import { authorizeRequest } from '@/features/auth/server/session'
import { StepUpSchema } from '@/features/security/domain'
import { createStepUp } from '@/features/security/server'
import { failure, ok, parseJson } from '@/lib/api/response'

export const dynamic = 'force-dynamic'
export const POST = withApiRoute('/api/security/step-up', async (request: Request) => {
  try {
    const session = await authorizeRequest('credentials.read')
    const input = await parseJson(request, StepUpSchema)
    return ok(await createStepUp(session, input))
  } catch (error) { return failure(error) }
})
