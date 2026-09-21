import { withApiRoute } from '@/lib/api/route'
import { ok,parseJson } from '@/lib/api/response'
import { FundingKeySchema } from '@/features/funding/domain'
import { fundingSession,recoverFunding } from '@/features/funding/server'
export const dynamic='force-dynamic'
export const POST=withApiRoute('/api/funding/recover',async(request:Request)=>{const s=await fundingSession(),v=await parseJson(request,FundingKeySchema);return ok(await recoverFunding(s,v.requestKey))})
