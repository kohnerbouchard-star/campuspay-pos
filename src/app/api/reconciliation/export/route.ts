import { withApiRoute } from '@/lib/api/route'
import { authorizeRequest } from '@/features/auth/server/session'
import { dailyReconciliation } from '@/features/reconciliation/server'
import { reconciliationCsv } from '@/features/reconciliation/domain'
export const dynamic='force-dynamic'
export const GET=withApiRoute('/api/reconciliation/export',async(request:Request)=>{
 const session=await authorizeRequest('reconciliation.read'),data=await dailyReconciliation(session,new URL(request.url).searchParams.get('day'))
 return new Response(reconciliationCsv(data),{headers:{'Content-Type':'text/csv; charset=utf-8','Content-Disposition':`attachment; filename="campuspay-reconciliation-${data.business_date}.csv"`,'Cache-Control':'private, no-store'}})
})
