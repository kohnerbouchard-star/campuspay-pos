import { z } from 'zod'
export const DENOMINATIONS = [50000,10000,5000,1000,500,100,50,10] as const
export const denominationTotal = (counts: Record<string, number>) => Object.entries(counts).reduce((sum,[unit,count]) => sum + Number(unit) * count,0)
const uuid = z.string().uuid()
const money = z.number().int().safe()
const notes = z.string().trim().min(10).max(500).refine(v => !/[\u0000-\u001f\u007f]/.test(v))
export const CashCountsSchema = z.record(z.string(),z.number().int().min(0).max(999999)).refine(v => Object.keys(v).length > 0 && Object.keys(v).every(k => DENOMINATIONS.some(n => String(n) === k)) && denominationTotal(v) <= 1000000000)
export const CashOpenSchema = z.object({ requestKey: uuid, counts: CashCountsSchema, verified: z.literal(true) }).strict()
export const CashCloseSchema = z.object({ requestKey: uuid, shiftId: uuid, counts: CashCountsSchema, notes, verified: z.literal(true) }).strict()
export const CashReviewSchema = z.object({ shiftId: uuid, notes }).strict()
export const CashRecoverySchema = z.object({ requestKey: uuid, operation: z.enum(['OPEN','CLOSE']), shiftId: uuid.nullable() }).strict()
 .refine(v => (v.operation === 'OPEN') === (v.shiftId === null))
export type CashRecovery = z.infer<typeof CashRecoverySchema>
export const CashShiftSchema = z.object({
 shift_id: uuid, terminal_id: uuid, terminal_label: z.string().nullable(), opened_by: uuid, opened_at: z.string(), closed_at: z.string().nullable(),
 funding_in_won: money.nonnegative().default(0), funding_out_won: money.nonnegative().default(0),
 opening_float_won: money.nonnegative(), cash_sales_won: money.nonnegative(), cash_payouts_won: money.nonnegative(), expected_won: money,
 counted_won: money.nonnegative().nullable(), variance_won: money.nullable(), close_notes: z.string().nullable(), closed_by: uuid.nullable(),
 approved_by: uuid.nullable(), approval_notes: z.string().nullable(), review_required: z.boolean(),
}).refine(v => v.expected_won === v.opening_float_won + v.cash_sales_won - v.cash_payouts_won + v.funding_in_won - v.funding_out_won && (v.counted_won === null || v.variance_won === v.counted_won - v.expected_won))
export type CashShift = z.infer<typeof CashShiftSchema>
export const CashSnapshotSchema = z.object({ enabled: z.boolean(), accountant_cash_enabled: z.boolean().default(false), terminal_id: uuid, current_shift: CashShiftSchema.nullable(), closed_shifts: z.array(CashShiftSchema), total_closed: money.nonnegative() })
export type CashSnapshot = z.infer<typeof CashSnapshotSchema>
export const CashResultSchema = z.discriminatedUnion('outcome',[
 z.object({ outcome: z.literal('COMPLETED'), shift: CashShiftSchema }), z.object({ outcome: z.literal('CLOSED'), shift: z.null() }),
])
