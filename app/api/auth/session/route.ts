import { authorizeAnyRequest } from '@/features/auth/server/session'
import { failure, ok } from '@/lib/api/response'

export const dynamic = 'force-dynamic'
export async function GET() {
  try { return ok(await authorizeAnyRequest()) }
  catch (error) { return failure(error) }
}
