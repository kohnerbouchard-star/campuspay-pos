import { z } from 'zod'
import { authorizeRequest } from '@/features/auth/server/session'
import { FinalizeTenderSchema } from '@/features/pos/domain'
import { finalizePaymentTender } from '@/features/pos/server'
import { failure, ok, parseJson } from '@/lib/api/response'

export async function POST(request: Request, context: { params: Promise<{ intentId: string }> }) {
  try {
    const session = await authorizeRequest('pos.checkout')
    const intentId = z.uuid().parse((await context.params).intentId)
    const input = await parseJson(request, FinalizeTenderSchema)
    return ok(await finalizePaymentTender(session, intentId, input.walletAmountWon))
  } catch (error) { return failure(error) }
}
