import { z } from 'zod'
import { ApiError } from '@/lib/api/errors'
import { withApiRoute } from '@/lib/api/route'
import { ok,parseJson } from '@/lib/api/response'
import { accessSession,employeeAccess,changeEmployeeAccess } from '@/features/access/server'
import { AccessChangeSchema } from '@/features/access/domain'
export const dynamic='force-dynamic'
type Context={params:Promise<{userId:string}>}
function id(v:string){const p=z.string().uuid().safeParse(v);if(!p.success)throw new ApiError(400,'BAD_REQUEST','Invalid employee reference');return p.data}
export const GET=withApiRoute('/api/administration/access/[userId]',async(_r:Request,c:Context)=>{const s=await accessSession();return ok(await employeeAccess(s,id((await c.params).userId)))})
export const POST=withApiRoute('/api/administration/access/[userId]',async(r:Request,c:Context)=>{const s=await accessSession(),target=id((await c.params).userId),v=await parseJson(r,AccessChangeSchema);if(v.targetId!==target)throw new ApiError(400,'BAD_REQUEST','Target employee does not match');return ok(await changeEmployeeAccess(s,v))})
