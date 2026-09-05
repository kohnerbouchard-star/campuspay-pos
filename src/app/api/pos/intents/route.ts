import { authorizeRequest } from '@/features/auth/server/session'
import { CreatePaymentIntentSchema } from '@/features/pos/domain'
import { createPaymentIntent } from '@/features/pos/server'
import { failure, ok, parseJson } from '@/lib/api/response'

export const dynamic = 'force-dynamic'
export async function POST(request: Request) {
  try {
    const session = await authorizeRequest('pos.checkout')
    const input = await parseJson(request, CreatePaymentIntentSchema)
    return ok(await createPaymentIntent(session, input.items, input.idempotencyKey, input.couponCode ?? null), { status: 201 })
  } catch (error) { return failure(error) }
}
