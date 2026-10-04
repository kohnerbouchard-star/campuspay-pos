import { withApiRoute } from '@/lib/api/route'
import { ok, parseJson } from '@/lib/api/response'
import { ApiError } from '@/lib/api/errors'
import { RecordChangeSchema, RecordQuerySchema } from '@/features/management/domain'
import { recordDirectory, changeRecord } from '@/features/management/server'
export const dynamic='force-dynamic'
export const GET=withApiRoute('/api/management',async(request:Request)=>{
  const q=new URL(request.url).searchParams
  const input=RecordQuerySchema.safeParse({kind:q.get('kind'),query:q.get('query')??'',status:q.get('status')??'ACTIVE',offset:q.get('offset')??0,targetId:q.get('targetId')})
  if(!input.success)throw new ApiError(400,'BAD_REQUEST','Choose a valid record type, filter and page.')
  return ok(await recordDirectory(input.data))
})
export const POST=withApiRoute('/api/management',async(request:Request)=>ok(await changeRecord(await parseJson(request,RecordChangeSchema))))
