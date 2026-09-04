import { authorizeRequest } from '@/features/auth/server/session'
import { searchStudentWallets } from '@/features/wallets/server'
import { failure, ok } from '@/lib/api/response'

export const dynamic = 'force-dynamic'
export async function GET(request: Request) {
  try {
    const session = await authorizeRequest('wallet.read')
    const query = new URL(request.url).searchParams.get('q')?.trim() ?? ''
    return ok(await searchStudentWallets(session, query))
  } catch (error) { return failure(error) }
}
