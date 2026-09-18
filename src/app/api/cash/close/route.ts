import { withApiRoute } from '@/lib/api/route'
import { ok, parseJson } from '@/lib/api/response'
import { cashSession, closeCash } from '@/features/cash/server'
import { CashCloseSchema } from '@/features/cash/domain'
export const dynamic = 'force-dynamic'
export const POST = withApiRoute('/api/cash/close',async (request: Request) => {
 const session = await cashSession()
 const input = await parseJson(request,CashCloseSchema)
 return ok(await closeCash(session,input))
})
