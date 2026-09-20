import { z } from 'zod'

const uuid = z.string().uuid()
const money = z.number().int().safe().nonnegative()
const text = (min: number, max: number) => z.string().trim().min(min).max(max).refine(value => !/[\u0000-\u001f\u007f]/.test(value))
export const RefundItemInputSchema = z.object({ sale_item_id: uuid, disposition: z.enum(['RESTOCK', 'WRITE_OFF']) }).strict()
export const PostRefundSchema = z.object({
  saleId: uuid, idempotencyKey: uuid, reasonCode: z.enum(['CUSTOMER_RETURN', 'ORDER_CANCELLED', 'DAMAGED', 'PRICING_ERROR', 'OTHER']),
  notes: text(10, 500), verified: z.literal(true), items: z.array(RefundItemInputSchema).min(1).max(100),
}).strict().refine(value => new Set(value.items.map(item => item.sale_item_id)).size === value.items.length, { message: 'Each sale item must appear once', path: ['items'] })
export type PostRefundInput = z.infer<typeof PostRefundSchema>
export const RecoverRefundSchema = z.object({ saleId: uuid, idempotencyKey: uuid }).strict()
export const CashPayoutSchema = z.object({ refundId: uuid, idempotencyKey: uuid, amountWon: money.positive(), handoverReference: text(3, 120), confirmed: z.literal(true) }).strict()
export const RefundRecordSchema = z.object({
  refund_id: uuid, sale_id: uuid, receipt_number: z.string(), scope: z.enum(['FULL','PARTIAL']).default('FULL'), kind: z.enum(['POS_REFUND','ONLINE_CANCELLATION','ONLINE_RETURN']),
  reason_code: z.string(), notes: z.string(), created_at: z.string(), total_won: money, cogs_reversed_won: money,
  restocked_cost_won: money, write_off_cost_won: money, coupon_policy: z.literal('KEEP_REDEMPTION'),
  wallet_credit_won: money, cash_due_won: money, cash_paid_won: money,
  items: z.array(z.object({ product_name: z.string(), quantity: money.positive(), restock_quantity: money, write_off_quantity: money, refund_won: money })).default([]),
  payout_reference: z.string().nullable(), payout_recorded_at: z.string().nullable(), operator_id: uuid, terminal_id: uuid,
}).refine(r => r.wallet_credit_won + r.cash_due_won === r.total_won && r.cash_paid_won <= r.cash_due_won
  && r.restocked_cost_won + r.write_off_cost_won === r.cogs_reversed_won, 'Refund totals must reconcile')
export type RefundRecord = z.infer<typeof RefundRecordSchema>
export const RefundDecisionSchema = z.discriminatedUnion('outcome', [
  z.object({ outcome: z.enum(['COMPLETED', 'ALREADY_REFUNDED']), refund: RefundRecordSchema }),
  z.object({ outcome: z.enum(['CLOSED','IDEMPOTENCY_CONFLICT','DISABLED','NOT_FOUND','ORDER_DISPATCHED','EXPIRED_STOCK','RETURN_INELIGIBLE','STALE_REFUND','INVALID_SELECTION','PARTIAL_REFUND_EXISTS']), refund: z.null() }),
])
export type RefundDecision = z.infer<typeof RefundDecisionSchema>
export const RefundSaleSchema = z.object({
  sale_id: uuid, receipt_number: z.string(), sold_at: z.string(), channel: z.enum(['POS','ONLINE_STORE']),
  student_name: z.string().nullable(), student_code: z.string().nullable(), year_group: z.number().int().nullable(),
  total_won: money, cogs_won: money, coupon_name: z.string().nullable(), order_status: z.string().nullable(), order_number: z.string().nullable(),
  wallet_tender_won: money, cash_tender_won: money, refund: RefundRecordSchema.nullable(),
  items: z.array(z.object({ sale_item_id: uuid, product_name: z.string(), quantity: z.number().int().positive(), cogs_won: money })).min(1),
})
export type RefundSale = z.infer<typeof RefundSaleSchema>
export const RefundRangeSchema = z.object({ from: z.string().date(), to: z.string().date() }).strict()
  .refine(value => { const days = (Date.parse(value.to) - Date.parse(value.from)) / 86400000; return days >= 0 && days <= 366 }, 'Choose a range of at most 367 calendar days')
export const RefundSummarySchema = z.object({
  sale_count: money, refund_count: money, gross_sales_won: money, refunds_won: money, net_sales_won: z.number().int().safe(),
  gross_cogs_won: money, cogs_reversed_won: money, write_off_cost_won: money, net_margin_won: z.number().int().safe(),
  cash_paid_won: money, outstanding_cash_won: money,
})
export type RefundSummary = z.infer<typeof RefundSummarySchema>
export const REFUND_MESSAGES: Record<RefundDecision['outcome'], string> = {
  STALE_REFUND: 'Another refund changed the remaining quantities. Reload and review a new calculation; nothing was posted.',
  INVALID_SELECTION: 'Choose remaining original quantities only. Nothing was posted.',
  PARTIAL_REFUND_EXISTS: 'Item-level refunds already exist. Use Item refunds and returns for the remaining quantities.',
  COMPLETED: 'Refund recorded. Review the wallet credit and any cash still due below.',
  ALREADY_REFUNDED: 'This sale was already refunded. No second refund was posted.',
  CLOSED: 'No refund committed for this request. It is now closed; a delayed request cannot post it.',
  IDEMPOTENCY_CONFLICT: 'The original operator must recover this request. Do not start another refund.',
  DISABLED: 'Refund posting is disabled in this database. Nothing was refunded.',
  NOT_FOUND: 'The original sale could not be found.',
  ORDER_DISPATCHED: 'This order is already dispatched, delivered, or otherwise ineligible. Use the separately reviewed return process; no refund was posted.',
  RETURN_INELIGIBLE: 'The order state no longer permits this return. Reload the original sale; nothing was refunded.',
  EXPIRED_STOCK: 'An original lot is expired. Choose Write off instead of returning it to saleable stock.',
}

export const PostReturnSchema = z.object({
  saleId: uuid, idempotencyKey: uuid, reasonCode: z.enum(['CUSTOMER_RETURN','ORDER_CANCELLED','DAMAGED','PRICING_ERROR','OTHER']),
  notes: text(10,500), verified: z.literal(true), returnReason: z.enum(['FAILED_DELIVERY','CUSTOMER_RETURN']),
  items: z.array(RefundItemInputSchema).min(1).max(100),
}).strict().refine(v => new Set(v.items.map(i => i.sale_item_id)).size === v.items.length)
export type PostReturnInput = z.infer<typeof PostReturnSchema>
