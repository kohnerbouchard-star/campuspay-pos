import { withApiRoute } from '@/lib/api/route'
import { cashSession } from '@/features/cash/server'
import { historyFilters,cashHistoryPage } from '@/features/history/server'
import { cashHistoryCsv } from '@/features/history/csv'
import { ApiError } from '@/lib/api/errors'
export const dynamic='force-dynamic'
export const GET=withApiRoute('/api/cash/history/export',async(request:Request)=>{
 const s=await cashSession(),data=await cashHistoryPage(s,historyFilters(new URL(request.url).searchParams),true)
 if(data.total!==data.rows.length)throw new ApiError(500,'INTERNAL_ERROR','The export did not include all matching records')
 return new Response(cashHistoryCsv(data),{headers:{'Content-Type':'text/csv; charset=utf-8','Content-Disposition':'attachment; filename="campuspay-cash-close-history.csv"','Cache-Control':'private, no-store'}})
})
