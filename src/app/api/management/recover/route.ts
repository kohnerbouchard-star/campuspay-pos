import { withApiRoute } from '@/lib/api/route'
import { ok, parseJson } from '@/lib/api/response'
import { RecordRecoverySchema } from '@/features/management/domain'
import { recoverRecord } from '@/features/management/server'
export const dynamic='force-dynamic'
export const POST=withApiRoute('/api/management/recover',async(request:Request)=>{
  const input=await parseJson(request,RecordRecoverySchema)
  return ok(await recoverRecord(input.kind,input.requestKey))
})
