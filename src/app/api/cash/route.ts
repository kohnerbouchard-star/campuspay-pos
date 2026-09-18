import { withApiRoute } from '@/lib/api/route'
import { ok } from '@/lib/api/response'
import { cashSession, cashSnapshot } from '@/features/cash/server'
export const dynamic = 'force-dynamic'
export const GET = withApiRoute('/api/cash', async (request: Request) => {
 const session = await cashSession()
 const offset = Number(new URL(request.url).searchParams.get('offset') ?? '0')
 return ok(await cashSnapshot(session,offset))
})
