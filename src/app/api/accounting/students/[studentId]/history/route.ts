import { z } from 'zod'
import { withApiRoute } from '@/lib/api/route'
import { ok } from '@/lib/api/response'
import { authorizeRequest } from '@/features/auth/server/session'
import { historyFilters,walletHistoryPage } from '@/features/history/server'
export const dynamic='force-dynamic'
export const GET=withApiRoute('/api/accounting/students/[studentId]/history',async(request:Request,context:{params:Promise<{studentId:string}>})=>{
 const s=await authorizeRequest('wallet.read'),{studentId}=await context.params
 return ok(await walletHistoryPage(s,z.string().uuid().parse(studentId),historyFilters(new URL(request.url).searchParams)))
})
