import { withApiRoute } from '@/lib/api/route'
import { ok } from '@/lib/api/response'
import { cashSession } from '@/features/cash/server'
import { historyFilters,cashHistoryPage } from '@/features/history/server'
export const dynamic='force-dynamic'
export const GET=withApiRoute('/api/cash/history',async(request:Request)=>{const s=await cashSession();return ok(await cashHistoryPage(s,historyFilters(new URL(request.url).searchParams)))})
