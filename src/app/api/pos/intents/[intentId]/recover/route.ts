import { z } from 'zod'
import { authorizeRequest } from '@/features/auth/server/session'
import { recoverPayment } from '@/features/pos/server'
import { failure, ok, parseJson } from '@/lib/api/response'
export const dynamic = 'force-dynamic'
export async function POST(request: Request, context: { params: Promise<{ intentId: string }> }) {
  try {
    const session = await authorizeRequest('pos.checkout')
    await parseJson(request, z.object({}).strict())
    const { intentId } = await context.params
    return ok(await recoverPayment(session, z.string().uuid().parse(intentId)))
  } catch (error) { return failure(error) }
}
