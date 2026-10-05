import 'server-only'
import { z } from 'zod'
import type { SessionContext } from '@/features/auth/domain'
import { authorizeAnyRequest } from '@/features/auth/server/session'
import { callApiRpc } from '@/lib/db/rpc'
import { ApiError } from '@/lib/api/errors'
import { fingerprintCard } from '@/lib/crypto/card-fingerprint'
import { studentPinProof } from '@/lib/crypto/student-pin'
import { staffPinProof } from '@/lib/crypto/staff-pin'
import { ConfirmFundingSchema,PrepareFundingSchema,FundingIntentSchema,FundingResultSchema,FundingHistorySchema,FundingExportSchema,FundingReadinessSchema,type PrepareFunding } from './domain'
export const fundingEnabled=()=>process.env.FUNDING_ENABLED==='true'
export async function fundingSession(){const s=await authorizeAnyRequest();if(!['wallet.read','wallet.fund','wallet.correct','wallet.reverse','cash.movement.record'].some(p=>s.permissions.includes(p as import('@/features/auth/domain').Permission)))throw new ApiError(403,'FORBIDDEN','Funding access is not permitted');return s}
const single=<T>(schema:z.ZodType<T>)=>z.array(z.object({result:schema})).length(1).transform(([r])=>r.result)
export function studentFundingReadiness(s:SessionContext,studentId:string){return callApiRpc('student_funding_readiness',{p_session_id:s.session_id,p_student_id:studentId},single(FundingReadinessSchema))}
export function prepareStudentFunding(s:SessionContext,studentId:string,input:PrepareFunding){
 enabled(); const v=PrepareFundingSchema.parse(input)
 if(v.action!=='CASH_DEPOSIT')throw new ApiError(400,'BAD_REQUEST','Choose a normal student deposit')
 return callApiRpc('prepare_student_funding',{p_session_id:s.session_id,p_student_id:studentId,p_key:v.requestKey,p_payload:{source_reference:v.sourceReference,notes:v.notes,denominations:v.denominations,cash_received_won:v.cashReceivedWon}},single(FundingIntentSchema))
}
function enabled(){if(!fundingEnabled())throw new ApiError(409,'CONFLICT','Wallet funding is not activated for this installation. No balance has changed')}
export function prepareFunding(s:SessionContext,input:PrepareFunding){
 const v=PrepareFundingSchema.parse(input)
 const permission=v.action==='CASH_DEPOSIT'?'wallet.fund':v.action==='REVERSE_FUNDING'?'wallet.reverse':['NONCASH_CREDIT','ADMIN_DEBIT'].includes(v.action)?'wallet.correct':'cash.movement.record'
 if(!s.permissions.includes(permission))throw new ApiError(403,'FORBIDDEN','This funding operation is not assigned')
 enabled()
 const payload:Record<string,unknown>={source_reference:v.sourceReference,notes:v.notes}
 if('denominations' in v)payload.denominations=v.denominations
 if(v.action==='CASH_DEPOSIT')payload.cash_received_won=v.cashReceivedWon
 if('counts' in v)payload.counts=v.counts
 if(v.action==='REVERSE_FUNDING')payload.original_reference=v.originalReference
 return callApiRpc('prepare_funding',{p_session_id:s.session_id,p_key:v.requestKey,p_action:v.action,p_payload:payload},single(FundingIntentSchema))
}
export function scanFunding(s:SessionContext,key:string,cardRead:string){enabled();return callApiRpc('scan_funding_card',{p_session_id:s.session_id,p_key:key,p_card_fingerprint:fingerprintCard(cardRead)},single(FundingIntentSchema))}
export async function confirmFunding(s:SessionContext,input:z.infer<typeof ConfirmFundingSchema>){
 enabled();const v=ConfirmFundingSchema.parse(input)
 const response=await callApiRpc('confirm_funding',{p_session_id:s.session_id,p_key:v.requestKey,p_student_pin_proof:v.studentPin?studentPinProof(v.studentPin):null,
 p_approver_code:v.approverCode??null,p_approver_proof:v.approverPin?staffPinProof(v.approverPin):null,p_verified:v.verified},single(FundingResultSchema))
 if(response.outcome==='REJECTED'){
  if(response.error_code==='APPROVAL_FAILED')throw new ApiError(403,'FORBIDDEN','Independent approval failed or is temporarily locked')
  if(response.error_code==='RATE_LIMITED')throw new ApiError(429,'RATE_LIMITED','Student PIN is temporarily locked')
  throw new ApiError(401,'INVALID_PIN','Student PIN verification failed; nothing was posted')
 }
 return response
}
export function recoverFunding(s:SessionContext,key:string){return callApiRpc('recover_funding',{p_session_id:s.session_id,p_key:key},single(FundingResultSchema))}
export function fundingRange(from:string|null,to:string|null){
 if(!from||!to||!/^\d{4}-\d{2}-\d{2}$/.test(from)||!/^\d{4}-\d{2}-\d{2}$/.test(to))throw new ApiError(400,'BAD_REQUEST','Choose a valid date range')
 const start=Date.parse(from+'T00:00:00Z'),end=Date.parse(to+'T00:00:00Z')
 if(!Number.isFinite(start)||!Number.isFinite(end)||new Date(start).toISOString().slice(0,10)!==from||new Date(end).toISOString().slice(0,10)!==to||end<start||end-start>365*86400000)throw new ApiError(400,'BAD_REQUEST','Choose a valid range of no more than 366 days')
 return {from,to}
}
export function fundingHistory(s:SessionContext,from:string,to:string,offset:number){
 if(!Number.isSafeInteger(offset)||offset<0||offset>2147483647)throw new ApiError(400,'BAD_REQUEST','Invalid journal page')
 return callApiRpc('funding_history',{p_session_id:s.session_id,p_from:from,p_to:to,p_offset:offset},single(FundingHistorySchema))
}
export function exportFunding(s:SessionContext,from:string,to:string){return callApiRpc('export_funding',{p_session_id:s.session_id,p_from:from,p_to:to},single(FundingExportSchema))}
