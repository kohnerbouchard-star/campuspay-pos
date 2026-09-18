import { withApiRoute } from '@/lib/api/route'
import { ok, parseJson } from '@/lib/api/response'
import { cashSession, openCash } from '@/features/cash/server'
import { CashOpenSchema } from '@/features/cash/domain'
export const dynamic = 'force-dynamic'
export const POST = withApiRoute('/api/cash/open',async (request: Request) => {
 const session = await cashSession()
 const input = await parseJson(request,CashOpenSchema)
 return ok(await openCash(session,input))
})
