import { withApiRoute } from '@/lib/api/route'
import { ok,parseJson } from '@/lib/api/response'
import { PrepareFundingSchema } from '@/features/funding/domain'
import { fundingSession,prepareFunding } from '@/features/funding/server'
export const dynamic='force-dynamic'
export const POST=withApiRoute('/api/funding/prepare',async(request:Request)=>{const s=await fundingSession();return ok(await prepareFunding(s,await parseJson(request,PrepareFundingSchema)))})
