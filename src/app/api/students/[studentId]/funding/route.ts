import { withApiRoute } from '@/lib/api/route'
import { authorizeRequest } from '@/features/auth/server/session'
import { ok, parseJson } from '@/lib/api/response'
import { z } from 'zod'
import { ApiError } from '@/lib/api/errors'
function routeUuid(value:string){const parsed=z.string().uuid().safeParse(value);if(!parsed.success)throw new ApiError(400,'BAD_REQUEST','Invalid student reference');return parsed.data}
import { PrepareFundingSchema } from '@/features/funding/domain'
import { prepareStudentFunding, studentFundingReadiness } from '@/features/funding/server'
export const dynamic='force-dynamic'
type Context={params:Promise<{studentId:string}>}
export const GET=withApiRoute('/api/students/[studentId]/funding',async(_r:Request,c:Context)=>{
 const s=await authorizeRequest('wallet.fund'),id=routeUuid((await c.params).studentId)
 return ok(await studentFundingReadiness(s,id))
})
export const POST=withApiRoute('/api/students/[studentId]/funding',async(r:Request,c:Context)=>{
 const s=await authorizeRequest('wallet.fund'),id=routeUuid((await c.params).studentId)
 return ok(await prepareStudentFunding(s,id,await parseJson(r,PrepareFundingSchema)))
})
