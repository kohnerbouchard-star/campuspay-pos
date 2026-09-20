import { z } from 'zod'

const money = z.number().int().safe().nonnegative()
const quantity = z.number().int().min(0).max(999999999)
const Selection = z.object({ sale_item_id: z.string().uuid().transform(v => v.toLowerCase()), restock_quantity: quantity, write_off_quantity: quantity }).strict()
  .refine(v => v.restock_quantity + v.write_off_quantity > 0, 'Select at least one unit')
export const PartialRefundPreviewInputSchema = z.object({ saleId: z.string().uuid(), items: z.array(Selection).min(1).max(100) }).strict()
  .refine(v => new Set(v.items.map(i => i.sale_item_id)).size === v.items.length, 'Each sale line must appear once')
export type PartialRefundPreviewInput = z.infer<typeof PartialRefundPreviewInputSchema>
const Allocation = z.object({ original_allocation_id: z.string().uuid(), inventory_lot_id: z.string().uuid(),
  restock_quantity: quantity, write_off_quantity: quantity, restocked_cost_won: money, write_off_cost_won: money })
const Item = z.object({ sale_item_id: z.string().uuid(), product_name: z.string(), sold_quantity: quantity.positive(),
  restock_quantity: quantity, write_off_quantity: quantity, original_line_net_won: money, refund_won: money,
  restocked_cost_won: money, write_off_cost_won: money, allocations: z.array(Allocation).min(1),
}).refine(v => v.restock_quantity + v.write_off_quantity > 0 && v.restock_quantity + v.write_off_quantity <= v.sold_quantity
  && v.refund_won <= v.original_line_net_won
  && v.allocations.reduce((n, a) => n + a.restock_quantity, 0) === v.restock_quantity
  && v.allocations.reduce((n, a) => n + a.write_off_quantity, 0) === v.write_off_quantity
  && v.allocations.reduce((n, a) => n + a.restocked_cost_won, 0) === v.restocked_cost_won
  && v.allocations.reduce((n, a) => n + a.write_off_cost_won, 0) === v.write_off_cost_won, 'Original costs and quantities must reconcile')
export const PartialRefundPreviewSchema = z.object({ outcome: z.literal('PREVIEW'), preview_only: z.literal(true), posting_available: z.literal(false),
  policy_version: z.literal('PARTIAL_REFUND_ALLOCATION_1'), coupon_policy: z.literal('KEEP_REDEMPTION'),
  sale_id: z.string().uuid(), receipt_number: z.string(), calculated_at: z.string(), original_total_won: money,
  refund_won: money, wallet_credit_won: money, cash_due_won: money, cogs_reversed_won: money,
  restocked_cost_won: money, write_off_cost_won: money, items: z.array(Item).min(1).max(100),
}).refine(v => v.refund_won <= v.original_total_won && v.wallet_credit_won + v.cash_due_won === v.refund_won
  && v.restocked_cost_won + v.write_off_cost_won === v.cogs_reversed_won
  && v.items.reduce((n, i) => n + i.refund_won, 0) === v.refund_won
  && v.items.reduce((n, i) => n + i.restocked_cost_won, 0) === v.restocked_cost_won
  && v.items.reduce((n, i) => n + i.write_off_cost_won, 0) === v.write_off_cost_won
  && new Set(v.items.map(i => i.sale_item_id)).size === v.items.length, 'Preview totals must reconcile')
export const PartialRefundPreviewDecisionSchema = z.discriminatedUnion('outcome', [PartialRefundPreviewSchema,
  z.object({ outcome: z.enum(['DISABLED', 'NOT_FOUND', 'ALREADY_REFUNDED', 'INELIGIBLE', 'INVALID_SELECTION', 'EXPIRED_STOCK']) }),
])
export type PartialRefundPreview = z.infer<typeof PartialRefundPreviewSchema>
export const PREVIEW_MESSAGES = {
  DISABLED: 'Item-level previews are not enabled in this database.',
  NOT_FOUND: 'The original sale could not be found.',
  ALREADY_REFUNDED: 'This sale already has a refund. Repeated partial posting is not available yet.',
  INELIGIBLE: 'Preview is available for POS sales or dispatched/delivered returns. Pre-dispatch cancellation remains a full-sale operation.',
  INVALID_SELECTION: 'Select only original sale lines and no more than the quantity sold.',
  EXPIRED_STOCK: 'An original selected lot is expired. Saleable restock is not available; inspect and choose write-off as appropriate.',
} as const
