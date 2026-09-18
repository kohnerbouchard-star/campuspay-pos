import { withApiRoute } from '@/lib/api/route'
import { ok, parseJson } from '@/lib/api/response'
import { cashSession, reviewCash } from '@/features/cash/server'
import { CashReviewSchema } from '@/features/cash/domain'
export const dynamic = 'force-dynamic'
export const POST = withApiRoute('/api/cash/review',async (request: Request) => {
 const session = await cashSession()
 const input = await parseJson(request,CashReviewSchema)
 return ok(await reviewCash(session,input))
})
