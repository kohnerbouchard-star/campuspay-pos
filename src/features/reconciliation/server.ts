import 'server-only'
import { z } from 'zod'
import { callApiRpc } from '@/lib/db/rpc'
import { ReconciliationDateSchema,ReconciliationSchema } from './domain'
import { ApiError } from '@/lib/api/errors'
import type { SessionContext } from '@/features/auth/domain'
export function dailyReconciliation(session:SessionContext,input:string|null){
 const day=ReconciliationDateSchema.safeParse(input)
 if(!day.success)throw new ApiError(400,'BAD_REQUEST','Choose a valid Korea business date')
 return callApiRpc('daily_reconciliation',{p_session_id:session.session_id,p_day:day.data},z.array(z.object({result:ReconciliationSchema})).length(1).transform(([row])=>row.result))
}
