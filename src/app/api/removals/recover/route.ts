import { withApiRoute } from '@/lib/api/route'
import { ok,parseJson } from '@/lib/api/response'
import { RemovalRecoverySchema } from '@/features/removal/domain'
import { recoverRemoval } from '@/features/removal/server'
export const POST=withApiRoute('/api/removals/recover',async(request:Request)=>ok(await recoverRemoval(await parseJson(request,RemovalRecoverySchema))))
