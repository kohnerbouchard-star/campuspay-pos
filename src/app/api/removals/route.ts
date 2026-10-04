import { withApiRoute } from '@/lib/api/route'
import { ApiError } from '@/lib/api/errors'
import { ok,parseJson } from '@/lib/api/response'
import { RemovalQuerySchema,RemovalChangeSchema } from '@/features/removal/domain'
import { removalDirectory,changeRemoval } from '@/features/removal/server'
export const dynamic='force-dynamic'
export const GET=withApiRoute('/api/removals',async(request:Request)=>{
 const q=new URL(request.url).searchParams
 const input=RemovalQuerySchema.safeParse({kind:q.get('kind')??'ALL',targetId:q.get('targetId'),offset:q.get('offset')??0})
 if(!input.success)throw new ApiError(400,'BAD_REQUEST','Choose a valid record type and page.')
 return ok(await removalDirectory(input.data))
})
export const POST=withApiRoute('/api/removals',async(request:Request)=>ok(await changeRemoval(await parseJson(request,RemovalChangeSchema))))
