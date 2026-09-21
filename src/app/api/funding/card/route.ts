import { withApiRoute } from '@/lib/api/route'
import { ok,parseJson } from '@/lib/api/response'
import { ScanFundingSchema } from '@/features/funding/domain'
import { fundingSession,scanFunding } from '@/features/funding/server'
export const dynamic='force-dynamic'
export const POST=withApiRoute('/api/funding/card',async(request:Request)=>{const s=await fundingSession(),v=await parseJson(request,ScanFundingSchema);return ok(await scanFunding(s,v.requestKey,v.cardRead))})
