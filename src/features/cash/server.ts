import 'server-only'
import { z } from 'zod'
import type { SessionContext } from '@/features/auth/domain'
import { authorizeAnyRequest } from '@/features/auth/server/session'
import { ApiError } from '@/lib/api/errors'
import { callApiRpc } from '@/lib/db/rpc'
import { CashShiftSchema, CashSnapshotSchema, CashResultSchema, CashOpenSchema, CashCloseSchema, CashReviewSchema, CashRecoverySchema } from './domain'
export function cashEnabled() { return process.env.CASH_CONTROLS_ENABLED === 'true' }
export async function cashSession() {
 const s = await authorizeAnyRequest()
 if (!['cashier','accountant','super_admin'].includes(s.role)) throw new ApiError(403,'FORBIDDEN','Cash register access is not permitted')
 return s
}
function writer(s: SessionContext) { if (!['cashier','accountant','super_admin'].includes(s.role)) throw new ApiError(403,'FORBIDDEN','This cash register view is read-only') }
const shiftResult = z.array(z.object({ result: CashShiftSchema })).length(1).transform(([row]) => row.result)
export function cashSnapshot(s: SessionContext, offset: number) {
 if (!Number.isInteger(offset) || offset < 0 || offset > 1000000) throw new ApiError(400,'BAD_REQUEST','Invalid page')
 return callApiRpc('cash_register_snapshot',{ p_session_id: s.session_id, p_offset: offset },z.array(z.object({ result: CashSnapshotSchema })).length(1).transform(([row]) => row.result))
}
export function openCash(s: SessionContext, input: z.infer<typeof CashOpenSchema>) {
 writer(s)
 if (s.role === 'accountant' && process.env.FUNDING_ENABLED !== 'true') throw new ApiError(403,'FORBIDDEN','Funding drawers are not activated')
 if (!cashEnabled()) throw new ApiError(403,'FORBIDDEN','New cash shifts are disabled for this installation')
 const v = CashOpenSchema.parse(input)
 return callApiRpc('open_cash_shift',{p_session_id:s.session_id,p_key:v.requestKey,p_counts:v.counts,p_verified:v.verified},shiftResult)
}
export function closeCash(s: SessionContext, input: z.infer<typeof CashCloseSchema>) {
 writer(s); const v=CashCloseSchema.parse(input)
 return callApiRpc('close_cash_shift',{p_session_id:s.session_id,p_shift_id:v.shiftId,p_key:v.requestKey,p_counts:v.counts,p_notes:v.notes,p_verified:v.verified},shiftResult)
}
export function recoverCash(s: SessionContext,input: z.infer<typeof CashRecoverySchema>) {
 writer(s);const v=CashRecoverySchema.parse(input)
 return callApiRpc('recover_cash_operation',{p_session_id:s.session_id,p_key:v.requestKey,p_operation:v.operation,p_shift_id:v.shiftId},z.array(z.object({result:CashResultSchema})).length(1).transform(([row])=>row.result))
}
export function reviewCash(s: SessionContext,input: z.infer<typeof CashReviewSchema>) {
 if (!['accountant','super_admin'].includes(s.role)) throw new ApiError(403,'FORBIDDEN','Independent accounting review is required')
 const v=CashReviewSchema.parse(input)
 return callApiRpc('approve_cash_variance',{p_session_id:s.session_id,p_shift_id:v.shiftId,p_notes:v.notes},shiftResult)
}
