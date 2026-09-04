import { authorizeRequest } from '@/features/auth/server/session'
import { ConfirmPaymentSchema } from '@/features/pos/domain'
import { confirmPayment } from '@/features/pos/server'
import { failure, ok, parseJson } from '@/lib/api/response'

export const dynamic = 'force-dynamic'
export async function POST(request: Request, context: { params: Promise<{ intentId: string }> }) {
  try {
    const session = await authorizeRequest('pos.checkout')
    const { intentId } = await context.params
    const input = await parseJson(request, ConfirmPaymentSchema)
    return ok(await confirmPayment(session, intentId, input.pin))
  } catch (error) { return failure(error) }
}
