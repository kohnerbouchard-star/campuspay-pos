import { withApiRoute } from '@/lib/api/route'
import { ok } from '@/lib/api/response'
import { fundingSession,fundingRange,fundingHistory } from '@/features/funding/server'
export const dynamic='force-dynamic'
export const GET=withApiRoute('/api/funding',async(request:Request)=>{const s=await fundingSession(),q=new URL(request.url).searchParams,range=fundingRange(q.get('from'),q.get('to'));return ok(await fundingHistory(s,range.from,range.to,Number(q.get('offset')??0)))})
