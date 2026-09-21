import { z } from 'zod'
import { CashShiftSchema } from '@/features/cash/domain'
import { WalletTransactionSchema } from '@/features/wallets/domain'
const money=z.number().int().safe(), count=money.nonnegative()
export const HistoryFiltersSchema=z.object({
 from:z.string().date().nullable(),to:z.string().date().nullable(),
 query:z.string().trim().max(120).refine(v=>![...v].some(c=>c.charCodeAt(0)<32||c.charCodeAt(0)===127)),
 offset:z.number().int().min(0).max(2147483647),
}).strict().refine(v=>(v.from===null)===(v.to===null),{message:'Choose both dates or all history'})
 .refine(v=>v.from===null||v.to===null||(v.to>=v.from&&Date.parse(v.to)-Date.parse(v.from)<=365*86400000),{message:'Use at most 366 inclusive days'})
export type HistoryFilters=z.infer<typeof HistoryFiltersSchema>
const common={from:z.string().nullable(),to:z.string().nullable(),query:z.string(),offset:count,total:count,generated_at:z.string()}
export const WalletHistoryPageSchema=z.object({...common,student_id:z.string().uuid(),net_amount_won:money,
 balance_won:money.nullable(),ledger_balance_won:money.nullable(),reconciliation_difference_won:money.nullable(),
 rows:z.array(WalletTransactionSchema.extend({ledger_id:z.string().uuid()}))})
export type WalletHistoryPage=z.infer<typeof WalletHistoryPageSchema>
export const CashHistoryRowSchema=z.object({shift:CashShiftSchema,opened_by_name:z.string(),closed_by_name:z.string(),approved_by_name:z.string().nullable()})
export const CashHistoryPageSchema=z.object({...common,scope:z.enum(['ALL_TERMINALS','CURRENT_TERMINAL']),opening_float_won:money.nonnegative(),
 expected_won:money,counted_won:money.nonnegative(),variance_won:money,unreviewed:count,rows:z.array(CashHistoryRowSchema)})
export type CashHistoryPage=z.infer<typeof CashHistoryPageSchema>
export const emptyHistoryFilters:HistoryFilters={from:null,to:null,query:'',offset:0}
export function historyParams(v:HistoryFilters):string{
 const q=new URLSearchParams({q:v.query,offset:String(v.offset)})
 if(v.from!==null)q.set('from',v.from)
 if(v.to!==null)q.set('to',v.to)
 return q.toString()
}
