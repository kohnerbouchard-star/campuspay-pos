import 'server-only'
import { z } from 'zod'
import { ApiError } from '@/lib/api/errors'
import { authorizeRequest } from '@/features/auth/server/session'
import { staffPinProof } from '@/lib/crypto/staff-pin'
import { callApiRpc } from '@/lib/db/rpc'
import { RecordDirectorySchema, RecordOutcomeSchema, type RecordKind, type RecordChange, type RecordQuerySchema } from './domain'
export function managementSession(kind:RecordKind, write=false) {
  return authorizeRequest(kind==='STUDENT'?'students.manage':write?'inventory.product.manage':'inventory.read')
}
export async function recordDirectory(input:z.infer<typeof RecordQuerySchema>) {
  const session=await managementSession(input.kind)
  return callApiRpc('record_directory',{p_session_id:session.session_id,p_kind:input.kind,p_query:input.query,p_status:input.status,p_offset:input.offset,p_target_id:input.targetId},
    z.array(z.object({result:RecordDirectorySchema})).length(1).transform(([r])=>r.result))
}
const result=z.array(z.object({result:RecordOutcomeSchema})).length(1).transform(([r])=>r.result)
export async function changeRecord(input:RecordChange) {
  const session=await managementSession(input.kind,true)
  const payload:Record<string,unknown>={}
  if ('expectedUpdatedAt' in input) payload.expected_updated_at=input.expectedUpdatedAt
  if ('name' in input) Object.assign(payload,{name:input.name,category:input.category,reorder_level:input.reorderLevel})
  if ('sellingPriceWon' in input) payload.selling_price_won=input.sellingPriceWon
  if ('sku' in input) Object.assign(payload,{sku:input.sku,selling_price_won:input.sellingPriceWon})
  const response=await callApiRpc('change_record',{p_session_id:session.session_id,p_key:input.requestKey,p_kind:input.kind,
    p_action:input.action,p_target_id:'targetId' in input?input.targetId:null,p_payload:payload,
    p_admin_pin_proof:'adminPin' in input?staffPinProof(input.adminPin):null,p_notes:input.reason},result)
  if(response.outcome==='AUTH_FAILED') throw new ApiError(403,'FORBIDDEN','Administrator PIN verification failed or is temporarily locked. No account status changed.')
  return response
}
export async function recoverRecord(kind:RecordKind,requestKey:string) {
  const session=await managementSession(kind,true)
  return callApiRpc('recover_record_operation',{p_session_id:session.session_id,p_key:requestKey,p_kind:kind},result)
}
