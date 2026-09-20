import { withApiRoute } from '@/lib/api/route'
import { ok,parseJson } from '@/lib/api/response'
import { administrationSession,recoverAdministration } from '@/features/administration/server'
import { AdministrationRecoverySchema } from '@/features/administration/domain'
export const dynamic='force-dynamic'
export const POST=withApiRoute('/api/administration/recover',async(request:Request)=>{const s=await administrationSession(),v=await parseJson(request,AdministrationRecoverySchema);return ok(await recoverAdministration(s,v.requestKey))})
