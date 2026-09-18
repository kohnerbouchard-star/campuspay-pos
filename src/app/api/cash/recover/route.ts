import { withApiRoute } from '@/lib/api/route'
import { ok, parseJson } from '@/lib/api/response'
import { cashSession, recoverCash } from '@/features/cash/server'
import { CashRecoverySchema } from '@/features/cash/domain'
export const dynamic = 'force-dynamic'
export const POST = withApiRoute('/api/cash/recover',async (request: Request) => {
 const session = await cashSession()
 const input = await parseJson(request,CashRecoverySchema)
 return ok(await recoverCash(session,input))
})
