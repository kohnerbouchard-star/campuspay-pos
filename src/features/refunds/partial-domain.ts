import { z } from 'zod'
import { RefundRecordSchema, RefundSaleSchema } from './domain'
const uuid = z.string().uuid().transform(v => v.toLowerCase())
const money = z.number().int().safe().nonnegative()
const quantity = z.number().int().min(0).max(999999999)
const text = z.string().trim().min(10).max(500).refine(v => [...v].every(c => c.charCodeAt(0) >= 32 && c.charCodeAt(0) !== 127))
export const PartialSelectionSchema = z.object({ original_allocation_id: uuid, restock_quantity: quantity, write_off_quantity: quantity }).strict()
  .refine(v => v.restock_quantity + v.write_off_quantity > 0, 'Select at least one original unit')
const items = z.array(PartialSelectionSchema).min(1).max(200).refine(v => new Set(v.map(x => x.original_allocation_id)).size === v.length, 'Select each original allocation once')
export const PartialQuoteInputSchema = z.object({ saleId: uuid, items }).strict()
export const PostPartialRefundSchema = z.object({ saleId: uuid, items, idempotencyKey: uuid, expectedRefundCount: money.max(2147483647),
  reasonCode: z.enum(['CUSTOMER_RETURN','DAMAGED','PRICING_ERROR','OTHER']), notes: text, verified: z.literal(true),
  returnReason: z.enum(['CUSTOMER_RETURN','FAILED_DELIVERY']).optional(),
}).strict()
export type PartialSelection = z.infer<typeof PartialSelectionSchema>
export type PostPartialRefundInput = z.infer<typeof PostPartialRefundSchema>
const Item = z.object({ sale_item_id: uuid, product_name: z.string(), quantity_before: quantity, restock_quantity: quantity,
  write_off_quantity: quantity, original_line_net_won: money, refund_won: money })
const Allocation = z.object({ original_allocation_id: uuid, sale_item_id: uuid, inventory_lot_id: uuid, quantity_before: quantity,
  restock_quantity: quantity, write_off_quantity: quantity, restocked_cost_won: money, write_off_cost_won: money })
export const PartialQuoteSchema = z.object({ outcome: z.literal('READY'), policy_version: z.literal('PARTIAL_REFUND_LOT_1'), sale_id: uuid,
  receipt_number: z.string(), prior_refund_count: money, previous_refund_won: money, original_total_won: money, refund_won: money,
  wallet_credit_won: money, cash_due_won: money, restocked_cost_won: money, write_off_cost_won: money, cogs_reversed_won: money,
  fully_returned: z.boolean(), items: z.array(Item).min(1), allocations: z.array(Allocation).min(1),
}).refine(v => v.refund_won + v.previous_refund_won <= v.original_total_won && v.wallet_credit_won + v.cash_due_won === v.refund_won
  && v.restocked_cost_won + v.write_off_cost_won === v.cogs_reversed_won && v.items.reduce((n,x) => n+x.refund_won,0) === v.refund_won
  && v.allocations.reduce((n,x) => n+x.restocked_cost_won,0) === v.restocked_cost_won
  && v.allocations.reduce((n,x) => n+x.write_off_cost_won,0) === v.write_off_cost_won, 'Quote totals must reconcile')
export type PartialQuote = z.infer<typeof PartialQuoteSchema>
export const PartialQuoteDecisionSchema = z.discriminatedUnion('outcome', [PartialQuoteSchema,
  z.object({ outcome: z.enum(['DISABLED','NOT_FOUND','ALREADY_REFUNDED','INELIGIBLE','INVALID_SELECTION','EXPIRED_STOCK']) }),
])
export const PartialSnapshotSchema = z.object({ sale: RefundSaleSchema, enabled: z.boolean(), returns_enabled: z.boolean(), offset: money,
  refund_count: money, refunded_won: money, refunds: z.array(RefundRecordSchema).max(50),
  allocations: z.array(z.object({ original_allocation_id: uuid, sale_item_id: uuid, product_name: z.string(), inventory_lot_id: uuid,
    lot_code: z.string().nullable(), stock_receipt: z.string(), received_at: z.string(), expiration_date: z.string().nullable(),
    sold_quantity: quantity.positive(), remaining_quantity: quantity })),
})
export type PartialSnapshot = z.infer<typeof PartialSnapshotSchema>
export const PartialDirectoryQuerySchema = z.object({ reference: z.string().trim().min(1).max(100), offset: z.coerce.number().int().min(0).max(2147483597).default(0) })
export const CustomerRefundsSchema = z.object({ order_id: uuid, refund_count: money, refunded_won: money, offset: money,
  refunds: z.array(z.object({ refund_id: uuid, scope: z.enum(['FULL','PARTIAL']), created_at: z.string(), total_won: money, wallet_credit_won: money,
    items: z.array(z.object({ product_name: z.string(), quantity: quantity.positive(), refund_won: money })) })).max(50),
})
