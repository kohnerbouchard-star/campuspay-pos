import { withApiRoute } from '@/lib/api/route'
import { fundingSession,fundingRange,exportFunding } from '@/features/funding/server'
import { fundingCsv } from '@/features/funding/csv'
export const dynamic='force-dynamic'
export const GET=withApiRoute('/api/funding/export',async(request:Request)=>{
 const s=await fundingSession(),q=new URL(request.url).searchParams,range=fundingRange(q.get('from'),q.get('to'))
 const report=await exportFunding(s,range.from,range.to)
 return new Response(fundingCsv(report.rows),{headers:{'Content-Type':'text/csv; charset=utf-8','Content-Disposition':`attachment; filename="campuspay-funding-${range.from}-${range.to}.csv"`,'Cache-Control':'private, no-store'}})
})
