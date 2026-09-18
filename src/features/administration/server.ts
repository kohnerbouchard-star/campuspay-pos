import 'server-only'
import { z } from 'zod'
import type { SessionContext } from '@/features/auth/domain'
import { authorizeRequest } from '@/features/auth/server/session'
import { callApiRpc } from '@/lib/db/rpc'
import { staffPinProof } from '@/lib/crypto/staff-pin'
import { ApiError } from '@/lib/api/errors'
import { AdministrationChangeSchema,AdministrationSnapshotSchema,AdministrationResultSchema,type AdministrationChange } from './domain'
export function administrationEnabled() { return process.env.ADMINISTRATION_ENABLED === 'true' }
export function administrationSession() { return authorizeRequest('security.staff.manage') }
const result = z.array(z.object({result:AdministrationResultSchema})).length(1).transform(([r])=>r.result)
export function administrationSnapshot(s:SessionContext,staffOffset:number,terminalOffset:number) {
 if (![staffOffset,terminalOffset].every(n=>Number.isSafeInteger(n)&&n>=0&&n<=2147483647)) throw new ApiError(400,'BAD_REQUEST','Invalid directory page')
 return callApiRpc('administration_snapshot',{p_session_id:s.session_id,p_staff_offset:staffOffset,p_terminal_offset:terminalOffset},z.array(z.object({result:AdministrationSnapshotSchema})).length(1).transform(([r])=>r.result))
}
export async function changeAdministration(s:SessionContext,input:AdministrationChange) {
 if (!administrationEnabled()) throw new ApiError(403,'FORBIDDEN','Staff and terminal changes are disabled for this installation')
 const v=AdministrationChangeSchema.parse(input)
 let payload:Record<string,unknown>={}
 switch(v.action) {
  case 'CREATE_STAFF': payload={employee_code:v.employeeCode,display_name:v.displayName,role:v.role,pin_proof:staffPinProof(v.newPin)};break
  case 'UPDATE_STAFF': payload={display_name:v.displayName,role:v.role,active:v.active,expected_updated_at:v.expectedUpdatedAt};break
  case 'RESET_STAFF_PIN': payload={pin_proof:staffPinProof(v.newPin)};break
  case 'UPDATE_TERMINAL': payload={label:v.label,active:v.active,expected_active:v.expectedActive,expected_label:v.expectedLabel};break
 }
 const response=await callApiRpc('change_administration',{p_session_id:s.session_id,p_key:v.requestKey,p_action:v.action,p_target_id:'targetId' in v?v.targetId:null,p_payload:payload,p_admin_pin_proof:staffPinProof(v.adminPin),p_notes:v.notes},result)
 if (response.outcome==='AUTH_FAILED') throw new ApiError(403,'FORBIDDEN','Administrator PIN verification failed or is temporarily locked')
 return response
}
export function recoverAdministration(s:SessionContext,requestKey:string) {
 return callApiRpc('recover_administration',{p_session_id:s.session_id,p_key:requestKey},result)
}
