import { withApiRoute } from '@/lib/api/route'
import { ok,parseJson } from '@/lib/api/response'
import { accessSession,recoverEmployeeAccess } from '@/features/access/server'
import { AccessRecoverySchema } from '@/features/access/domain'
export const dynamic='force-dynamic'
export const POST=withApiRoute('/api/administration/access/recover',async(r:Request)=>{const s=await accessSession();return ok(await recoverEmployeeAccess(s,(await parseJson(r,AccessRecoverySchema)).requestKey))})
