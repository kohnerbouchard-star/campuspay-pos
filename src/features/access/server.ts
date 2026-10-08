import 'server-only'
import { z } from 'zod'
import { authorizeRequest } from '@/features/auth/server/session'
import type { SessionContext } from '@/features/auth/domain'
import { callApiRpc } from '@/lib/db/rpc'
import { ApiError } from '@/lib/api/errors'
import { staffPinProof } from '@/lib/crypto/staff-pin'
import { AccessSnapshotSchema,AccessChangeSchema,AccessResultSchema,PresetDefaultsSchema,type AccessChange } from './domain'
export async function accessSession(){const s=await authorizeRequest('staff.access.manage');if(s.role!=='super_admin'||s.preset!=='super_admin')throw new ApiError(403,'FORBIDDEN','Super Admin access assignment is required');return s}
const result=z.array(z.object({result:AccessResultSchema})).length(1).transform(([r])=>r.result)
export async function employeeAccess(s:SessionContext,id:string){const rows=await callApiRpc('employee_access',{p_session_id:s.session_id,p_target_id:id},z.array(z.object({result:AccessSnapshotSchema})).max(1));if(!rows[0])throw new ApiError(404,'NOT_FOUND','Employee not found');return rows[0].result}
export function accessDefaults(s:SessionContext){return callApiRpc('access_defaults',{p_session_id:s.session_id},PresetDefaultsSchema)}
export async function changeEmployeeAccess(s:SessionContext,input:AccessChange){
 if(process.env.ADMINISTRATION_ENABLED!=='true')throw new ApiError(409,'ADMINISTRATION_DISABLED','Access changes are not activated for this installation')
 const v=AccessChangeSchema.parse(input)
 const r=await callApiRpc('change_employee_access',{p_session_id:s.session_id,p_key:v.requestKey,p_target_id:v.targetId,p_expected_revision:v.expectedRevision,p_previous_preset:v.previousPreset,p_previous_permissions:v.previousPermissions,p_new_preset:v.newPreset,p_new_permissions:v.permissions,p_admin_pin_proof:staffPinProof(v.adminPin),p_reason:v.reason,p_confirmed:v.confirmed},result)
 if(r.outcome==='AUTH_FAILED')throw new ApiError(403,'FORBIDDEN','Current administrator PIN verification failed. No access changed')
 return r
}
export function recoverEmployeeAccess(s:SessionContext,key:string){return callApiRpc('recover_employee_access',{p_session_id:s.session_id,p_key:key},result)}
