import { withApiRoute } from '@/lib/api/route'
import { ok } from '@/lib/api/response'
import { authorizeRequest } from '@/features/auth/server/session'
import { dailyReconciliation } from '@/features/reconciliation/server'
export const dynamic='force-dynamic'
export const GET=withApiRoute('/api/reconciliation',async(request:Request)=>{const session=await authorizeRequest('reports.sales');return ok(await dailyReconciliation(session,new URL(request.url).searchParams.get('day')))})
