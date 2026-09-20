import { describe, it, expect } from 'vitest'
import { PostPartialRefundSchema, PartialQuoteInputSchema, PartialQuoteSchema } from '../partial-domain'
import { RefundDecisionSchema } from '../domain'
const id = '80000000-0000-4000-8000-000000000001'
const input = { saleId: id, idempotencyKey: id, expectedRefundCount: 0, reasonCode: 'OTHER', notes: 'Receipt and original lot physically verified', verified: true,
  items: [{ original_allocation_id: id, restock_quantity: 1, write_off_quantity: 0 }] }
describe('inspected cumulative partial refund input', () => {
  it('requires an explicit original allocation, version and inspection', () => expect(PostPartialRefundSchema.parse(input)).toEqual(input))
  it.each([{ amountWon: 1 },{ role: 'super_admin' },{ verified: false },{ expectedRefundCount: -1 },{ expectedRefundCount: undefined },{ notes: 'short' },{ notes: 'control\nnot permitted' },{ reasonCode: 'ORDER_CANCELLED' },{ returnReason: 'DELIVERED' },
    { items: [] },{ items: [input.items[0],input.items[0]] },{ items: [{ ...input.items[0], restock_quantity: -1 }] },{ items: [{ ...input.items[0], write_off_quantity: 0.5 }] },
    { items: [{ ...input.items[0], restock_quantity: 0 }] },{ items: [{ ...input.items[0], amountWon: 1 }] },{ items: [{ sale_item_id: id, restock_quantity: 1, write_off_quantity: 0 }] }])('rejects unsafe or ambiguous input %#', v => expect(PostPartialRefundSchema.safeParse({ ...input,...v }).success).toBe(false))
  it('does not mistake preview input for posting authorization', () => {
    const q = { saleId: id, items: input.items }; expect(PartialQuoteInputSchema.safeParse(q).success).toBe(true)
    expect(PostPartialRefundSchema.safeParse(q).success).toBe(false)
  })
  it.each(['STALE_REFUND','INVALID_SELECTION','PARTIAL_REFUND_EXISTS'])('represents %s as no refund', outcome => expect(RefundDecisionSchema.parse({ outcome,refund:null }).refund).toBeNull())
  it('rejects a ready quote whose totals exceed original payment', () => {
    const q = { outcome:'READY',policy_version:'PARTIAL_REFUND_LOT_1',sale_id:id,receipt_number:'TEST',prior_refund_count:1,previous_refund_won:10,original_total_won:10,
      refund_won:1,wallet_credit_won:1,cash_due_won:0,restocked_cost_won:0,write_off_cost_won:0,cogs_reversed_won:0,fully_returned:false,
      items:[{sale_item_id:id,product_name:'Fixture',quantity_before:1,restock_quantity:1,write_off_quantity:0,original_line_net_won:10,refund_won:1}],
      allocations:[{original_allocation_id:id,sale_item_id:id,inventory_lot_id:id,quantity_before:1,restock_quantity:1,write_off_quantity:0,restocked_cost_won:0,write_off_cost_won:0}] }
    expect(PartialQuoteSchema.safeParse(q).success).toBe(false)
  })
})
