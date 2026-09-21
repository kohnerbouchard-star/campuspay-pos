import { withApiRoute } from '@/lib/api/route'
import { ok,parseJson } from '@/lib/api/response'
import { ConfirmFundingSchema } from '@/features/funding/domain'
import { fundingSession,confirmFunding } from '@/features/funding/server'
export const dynamic='force-dynamic'
export const POST=withApiRoute('/api/funding/confirm',async(request:Request)=>{const s=await fundingSession();return ok(await confirmFunding(s,await parseJson(request,ConfirmFundingSchema)))})
