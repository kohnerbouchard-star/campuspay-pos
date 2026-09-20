import { describe, expect, it } from 'vitest'
import { PartialRefundPreviewInputSchema, PartialRefundPreviewSchema } from '../preview-domain'

const saleId = '70000000-0000-4000-8000-000000000001'
const itemId = 'a0000000-0000-4000-8000-000000000002'
const line = { sale_item_id: itemId, restock_quantity: 1, write_off_quantity: 1 }
const request = { saleId, items: [line] }
describe('non-posting item-level refund preview contract', () => {
  it('accepts a mixed inspected disposition without a client-supplied amount', () => expect(PartialRefundPreviewInputSchema.parse(request)).toEqual(request))
  it.each([
    { items: [] }, { items: [line, line] }, { items: [line, { ...line, sale_item_id: itemId.toUpperCase() }] },
    { items: [{ ...line, restock_quantity: -1 }] }, { items: [{ ...line, write_off_quantity: 1.5 }] },
    { items: [{ ...line, restock_quantity: '1' }] }, { items: [{ ...line, restock_quantity: NaN }] },
    { items: [{ ...line, restock_quantity: 1000000000 }] }, { items: [{ ...line, restock_quantity: 0, write_off_quantity: 0 }] },
    { items: [{ ...line, amount_won: 1 }] }, { items: [{ ...line, write_off_quantity: null }] },
    { items: Array.from({ length: 101 }, () => line) }, { amountWon: 1000 }, { adminPin: '12345678' },
    { idempotencyKey: saleId }, { saleId: 'not-a-uuid' },
  ])('rejects malformed or posting-like input %#', invalid => expect(PartialRefundPreviewInputSchema.safeParse({ ...request, ...invalid }).success).toBe(false))
  const preview = { outcome: 'PREVIEW', preview_only: true, posting_available: false, policy_version: 'PARTIAL_REFUND_ALLOCATION_1',
    coupon_policy: 'KEEP_REDEMPTION', sale_id: saleId, receipt_number: 'TEST', calculated_at: '2026-09-20T00:00:00Z',
    original_total_won: 1001, refund_won: 667, wallet_credit_won: 332, cash_due_won: 335,
    cogs_reversed_won: 133, restocked_cost_won: 66, write_off_cost_won: 67,
    items: [{ ...line, sold_quantity: 3, product_name: 'Synthetic product', original_line_net_won: 1001, refund_won: 667,
      restocked_cost_won: 66, write_off_cost_won: 67, allocations: [{ original_allocation_id: itemId, inventory_lot_id: saleId,
        restock_quantity: 1, write_off_quantity: 1, restocked_cost_won: 66, write_off_cost_won: 67 }] }],
  }
  it('accepts a reconciled estimate', () => expect(PartialRefundPreviewSchema.safeParse(preview).success).toBe(true))
  it.each([{ posting_available: true }, { preview_only: false }, { refund_won: 1002 }, { cash_due_won: 336 },
    { cogs_reversed_won: 132 }, { items: [] }, { original_total_won: Number.MAX_SAFE_INTEGER + 1 },
    { items: [{ ...preview.items[0], sold_quantity: 1 }] }, { items: [{ ...preview.items[0], allocations: [] }] },
    { items: [{ ...preview.items[0], refund_won: 668 }] }, { items: [preview.items[0], preview.items[0]] },
  ])('rejects an unsafe or non-reconciling response %#', invalid => expect(PartialRefundPreviewSchema.safeParse({ ...preview, ...invalid }).success).toBe(false))
})
