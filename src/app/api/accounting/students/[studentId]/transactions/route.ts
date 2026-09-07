import { z } from 'zod'
import { authorizeRequest } from '@/features/auth/server/session'
import { walletHistory } from '@/features/wallets/server'
import { failure, ok } from '@/lib/api/response'
export const dynamic = 'force-dynamic'
export async function GET(_request: Request, context: { params: Promise<{ studentId: string }> }) {
  try {
    const session = await authorizeRequest('wallet.read')
    const { studentId } = await context.params
    return ok(await walletHistory(session, z.string().uuid().parse(studentId)))
  } catch (error) { return failure(error) }
}
