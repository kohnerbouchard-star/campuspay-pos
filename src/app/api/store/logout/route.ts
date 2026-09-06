import { logoutCustomerSession } from '@/features/store/server/session'
import { failure, ok, parseJson } from '@/lib/api/response'
import { z } from 'zod'

export const dynamic = 'force-dynamic'
export async function POST(request: Request) {
  try {
    await parseJson(request, z.object({}))
    await logoutCustomerSession()
    return ok({ signedOut: true as const })
  } catch (error) { return failure(error) }
}
