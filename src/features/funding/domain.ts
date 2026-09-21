import { z } from 'zod'
import { CashCountsSchema } from '@/features/cash/domain'
const uuid=z.string().uuid(),money=z.number().int().safe()
const clean=(min:number,max:number)=>z.string().trim().min(min).max(max).refine(v=>![...v].some(c=>c.charCodeAt(0)<32||c.charCodeAt(0)===127))
const denominations=z.array(z.union([z.literal(1000),z.literal(5000),z.literal(10000),z.literal(20000),z.literal(50000)])).min(1).max(30)
const common={requestKey:uuid,sourceReference:clean(3,120),notes:clean(10,500)}
export const FundingActionSchema=z.enum(['CASH_DEPOSIT','NONCASH_CREDIT','ADMIN_DEBIT','REVERSE_FUNDING','PAID_IN','PAID_OUT','CASH_DROP'])
export type FundingAction=z.infer<typeof FundingActionSchema>
export const PrepareFundingSchema=z.discriminatedUnion('action',[
 z.object({...common,action:z.literal('CASH_DEPOSIT'),denominations,cashReceivedWon:money.positive().max(1000000000)}).strict(),
 z.object({...common,action:z.enum(['NONCASH_CREDIT','ADMIN_DEBIT']),denominations}).strict(),
 z.object({...common,action:z.literal('REVERSE_FUNDING'),originalReference:clean(1,80)}).strict(),
 z.object({...common,action:z.enum(['PAID_IN','PAID_OUT','CASH_DROP']),counts:CashCountsSchema.refine(c=>Object.entries(c).reduce((t,[d,n])=>t+Number(d)*n,0)>0)}).strict(),
]).refine(v=>v.action!=='CASH_DEPOSIT'||v.cashReceivedWon>=v.denominations.reduce((a,b)=>a+b,0),{message:'Cash received must cover the deposit'})
export type PrepareFunding=z.infer<typeof PrepareFundingSchema>
export const FundingKeySchema=z.object({requestKey:uuid}).strict()
export const ScanFundingSchema=z.object({requestKey:uuid,cardRead:z.string().regex(/^[A-Za-z0-9:-]{6,64}$/)}).strict()
const pin=z.string().regex(/^\d{4,12}$/)
export const ConfirmFundingSchema=z.object({requestKey:uuid,studentPin:pin.optional(),approverCode:z.string().regex(/^[A-Za-z0-9_-]{2,32}$/).optional(),approverPin:z.string().regex(/^\d{4,16}$/).optional(),verified:z.literal(true)}).strict()
 .refine(v=>(v.approverCode===undefined)===(v.approverPin===undefined))
export const FundingIntentSchema=z.object({request_key:uuid,action:FundingActionSchema,state:z.enum(['PREPARED','SCANNED','COMPLETED','CLOSED']),
 wallet_delta_won:money,cash_delta_won:money,cash_received_won:money.nonnegative(),change_won:money.nonnegative(),shift_id:uuid.nullable(),
 student_id:uuid.nullable(),student_name:z.string().nullable(),student_code:z.string().nullable(),year_group:money.nullable(),balance_won:money.nullable(),
 source_reference:z.string(),notes:z.string(),expires_at:z.string(),original_reference:z.string().nullable(),requires_card:z.boolean(),requires_approval:z.boolean()})
export type FundingIntent=z.infer<typeof FundingIntentSchema>
export const FundingReceiptSchema=z.object({operation_id:uuid,request_key:uuid,reference_number:z.string(),action:FundingActionSchema,
 wallet_delta_won:money,cash_delta_won:money,cash_received_won:money.nonnegative(),change_won:money.nonnegative(),balance_before_won:money.nullable(),balance_after_won:money.nullable(),
 student_code:z.string().nullable(),student_name:z.string().nullable(),shift_id:uuid.nullable(),terminal_id:uuid,terminal_label:z.string().nullable(),actor_name:z.string(),approver_name:z.string().nullable(),
 source_reference:z.string(),notes:z.string(),created_at:z.string(),original_reference:z.string().nullable(),reversed_by_reference:z.string().nullable()})
export type FundingReceipt=z.infer<typeof FundingReceiptSchema>
export const FundingResultSchema=z.discriminatedUnion('outcome',[
 z.object({outcome:z.literal('COMPLETED'),receipt:FundingReceiptSchema}),z.object({outcome:z.literal('CLOSED')}),
 z.object({outcome:z.literal('REJECTED'),error_code:z.enum(['INVALID_PIN','RATE_LIMITED','APPROVAL_FAILED'])})])
export type FundingResult=z.infer<typeof FundingResultSchema>
export const FundingHistorySchema=z.object({enabled:z.boolean(),required:z.boolean(),finance_access:z.boolean(),from:z.string(),to:z.string(),offset:money.nonnegative(),total:money.nonnegative(),
 wallet_net_won:money,cash_in_won:money.nonnegative(),cash_out_won:money.nonnegative(),rows:z.array(FundingReceiptSchema),wallets_checked:money.nullable(),wallet_mismatches:money.nullable(),
 closed_shifts_checked:money.nonnegative(),closed_shift_mismatches:money.nonnegative(),unreviewed_variances:money.nonnegative(),unresolved_requests:money.nonnegative()})
export type FundingHistory=z.infer<typeof FundingHistorySchema>
export const FundingExportSchema=z.object({total:money.nonnegative(),from:z.string(),to:z.string(),rows:z.array(FundingReceiptSchema)}).refine(v=>v.total===v.rows.length)
export const FUNDING_LABELS:Record<FundingAction,string>={CASH_DEPOSIT:'Cash wallet deposit',NONCASH_CREDIT:'Approved non-cash credit',ADMIN_DEBIT:'Approved wallet deduction',REVERSE_FUNDING:'Reverse a funding receipt',PAID_IN:'Cash paid in',PAID_OUT:'Cash paid out',CASH_DROP:'Cash drop to safe / bank'}
