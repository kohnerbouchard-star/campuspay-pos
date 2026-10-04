import 'server-only'
import { z } from 'zod'
import { authorizeRequest } from '@/features/auth/server/session'
import { administrationEnabled } from '@/features/administration/server'
import { staffPinProof } from '@/lib/crypto/staff-pin'
import { callApiRpc } from '@/lib/db/rpc'
import { ApiError } from '@/lib/api/errors'
import { RemovalDirectorySchema,RemovalResultSchema,type RemovalChange,type RemovalQuerySchema,type RemovalRecoverySchema } from './domain'
const result=z.array(z.object({result:RemovalResultSchema})).length(1).transform(([r])=>r.result)
export async function removalDirectory(input:z.infer<typeof RemovalQuerySchema>){
 const s=await authorizeRequest('security.staff.manage')
 return callApiRpc('removal_directory',{p_session_id:s.session_id,p_kind:input.kind,p_target_id:input.targetId,p_offset:input.offset},z.array(z.object({result:RemovalDirectorySchema})).length(1).transform(([r])=>r.result))
}
export async function changeRemoval(input:RemovalChange){
 const s=await authorizeRequest('security.staff.manage')
 if(!administrationEnabled())throw new ApiError(403,'ADMINISTRATION_DISABLED','Super Admin record deletion is disabled for this installation.')
 const response=await callApiRpc('change_record_removal',{p_session_id:s.session_id,p_key:input.requestKey,p_kind:input.kind,p_action:input.action,p_target_id:input.targetId,p_version:input.expectedVersion,p_admin_pin_proof:staffPinProof(input.adminPin),p_notes:input.reason},result)
 if(response.outcome==='AUTH_FAILED')throw new ApiError(403,'FORBIDDEN','Current Super Admin PIN verification failed or is temporarily locked. No record was deleted or restored.')
 return response
}
export async function recoverRemoval(input:z.infer<typeof RemovalRecoverySchema>){
 const s=await authorizeRequest('security.staff.manage')
 return callApiRpc('recover_record_removal',{p_session_id:s.session_id,p_key:input.requestKey,p_kind:input.kind},result)
}
