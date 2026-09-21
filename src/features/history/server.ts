import 'server-only'
import { z } from 'zod'
import type { SessionContext } from '@/features/auth/domain'
import { callApiRpc } from '@/lib/db/rpc'
import { ApiError } from '@/lib/api/errors'
import { HistoryFiltersSchema,WalletHistoryPageSchema,CashHistoryPageSchema,type HistoryFilters } from './domain'
const single=<T>(schema:z.ZodType<T>)=>z.array(z.object({result:schema})).length(1).transform(([row])=>row.result)
export function historyFilters(q:URLSearchParams):HistoryFilters{
 const result=HistoryFiltersSchema.safeParse({from:q.get('from')||null,to:q.get('to')||null,query:q.get('q')??'',offset:Number(q.get('offset')??0)})
 if(!result.success)throw new ApiError(400,'BAD_REQUEST','Choose both valid Korea dates (at most 366 days), or all history, and a valid page.')
 return result.data
}
function args(s:SessionContext,v:HistoryFilters,exportAll:boolean){return {p_session_id:s.session_id,p_from:v.from,p_to:v.to,p_query:v.query,p_offset:exportAll?0:v.offset,p_export:exportAll}}
export function walletHistoryPage(s:SessionContext,studentId:string,v:HistoryFilters,exportAll=false){
 return callApiRpc('student_wallet_history_page',{...args(s,v,exportAll),p_student_id:studentId},single(WalletHistoryPageSchema))
}
export function cashHistoryPage(s:SessionContext,v:HistoryFilters,exportAll=false){
 return callApiRpc('cash_history_page',args(s,v,exportAll),single(CashHistoryPageSchema))
}
