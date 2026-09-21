import { z } from 'zod'
import { withApiRoute } from '@/lib/api/route'
import { authorizeRequest } from '@/features/auth/server/session'
import { historyFilters,walletHistoryPage } from '@/features/history/server'
import { walletHistoryCsv } from '@/features/history/csv'
import { ApiError } from '@/lib/api/errors'
export const dynamic='force-dynamic'
export const GET=withApiRoute('/api/accounting/students/[studentId]/history/export',async(request:Request,context:{params:Promise<{studentId:string}>})=>{
 const s=await authorizeRequest('wallet.read'),{studentId}=await context.params
 const data=await walletHistoryPage(s,z.string().uuid().parse(studentId),historyFilters(new URL(request.url).searchParams),true)
 if(data.total!==data.rows.length)throw new ApiError(500,'INTERNAL_ERROR','The export did not include all matching records')
 return new Response(walletHistoryCsv(data),{headers:{'Content-Type':'text/csv; charset=utf-8','Content-Disposition':'attachment; filename="campuspay-wallet-history.csv"','Cache-Control':'private, no-store'}})
})
