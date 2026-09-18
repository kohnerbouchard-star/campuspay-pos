import { describe, expect, it } from 'vitest'
import { CashPayoutSchema, PostRefundSchema, RefundDecisionSchema, RefundRangeSchema, RefundRecordSchema } from '../domain'
import { clearRefundRecovery, readRefundRecovery, saveRefundRecovery, REFUND_RECOVERY_KEY } from '../storage'
const id = '60000000-0000-4000-8000-000000000001'
const other = '60000000-0000-4000-8000-000000000002'
const input = { saleId: id, idempotencyKey: other, reasonCode: 'OTHER', notes: 'Verified full return', verified: true, items: [{ sale_item_id: id, disposition: 'RESTOCK' }] }
const record = { refund_id: id, sale_id: other, receipt_number: 'QA-RECEIPT', kind: 'POS_REFUND', reason_code: 'OTHER', notes: 'Verified full return', created_at: '2026-09-18T01:00:00Z', total_won: 1200, cogs_reversed_won: 500, restocked_cost_won: 300, write_off_cost_won: 200, coupon_policy: 'KEEP_REDEMPTION', wallet_credit_won: 500, cash_due_won: 700, cash_paid_won: 0, payout_reference: null, payout_recorded_at: null, operator_id: id, terminal_id: other }
function storage() { const data = new Map<string, string>(); return { data, getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value) }, removeItem: (key: string) => { data.delete(key) } } }
describe('full-sale refund contract', () => {
  it('accepts an explicit verified full-item disposition', () => expect(PostRefundSchema.parse(input).items).toHaveLength(1))
  it.each([false, null, undefined])('requires explicit receipt verification: %s', value => expect(PostRefundSchema.safeParse({ ...input, verified: value }).success).toBe(false))
  it.each(['', 'short', '\nnot safe text\u0000'])('rejects inadequate notes: %s', notes => expect(PostRefundSchema.safeParse({ ...input, notes }).success).toBe(false))
  it('rejects unknown roles or client-specified refund amounts', () => expect(PostRefundSchema.safeParse({ ...input, totalWon: 9999, role: 'super_admin' }).success).toBe(false))
  it('rejects partial quantities and unexpected item fields', () => expect(PostRefundSchema.safeParse({ ...input, items: [{ ...input.items[0], quantity: 1 }] }).success).toBe(false))
  it('rejects duplicate item IDs', () => expect(PostRefundSchema.safeParse({ ...input, items: [input.items[0], input.items[0]] }).success).toBe(false))
  it.each([[], Array.from({ length: 101 }, () => input.items[0])])('bounds the item list', items => expect(PostRefundSchema.safeParse({ ...input, items }).success).toBe(false))
  it('accepts explicit non-restockable write-off disposition', () => expect(PostRefundSchema.safeParse({ ...input, items: [{ sale_item_id: id, disposition: 'WRITE_OFF' }] }).success).toBe(true))
  it('reconciles mixed tender and original costs', () => expect(RefundRecordSchema.safeParse(record).success).toBe(true))
  it.each([{ total_won: 1201 }, { cash_paid_won: 701 }, { write_off_cost_won: 201 }, { coupon_policy: 'RESTORE' }, { wallet_credit_won: Number.MAX_SAFE_INTEGER + 1 }])('rejects inconsistent receipt %j', change => expect(RefundRecordSchema.safeParse({ ...record, ...change }).success).toBe(false))
  it('requires a receipt for a successful decision', () => expect(RefundDecisionSchema.safeParse({ outcome: 'COMPLETED', refund: null }).success).toBe(false))
  it('never treats a closure as a posted refund', () => expect(RefundDecisionSchema.parse({ outcome: 'CLOSED', refund: null }).refund).toBeNull())
  it('requires explicit confirmed cash handover and a positive amount', () => {
    const payout = { refundId: id, idempotencyKey: other, amountWon: 700, handoverReference: 'QA handover', confirmed: true }
    expect(CashPayoutSchema.safeParse(payout).success).toBe(true)
    for (const change of [{ confirmed: false }, { amountWon: 0 }, { amountWon: -1 }, { handoverReference: '' }]) expect(CashPayoutSchema.safeParse({ ...payout, ...change }).success).toBe(false)
  })
  it.each([{ from: '2026-09-19', to: '2026-09-18' }, { from: '2025-01-01', to: '2026-09-18' }, { from: 'invalid', to: '2026-09-18' }])('rejects invalid report range %j', range => expect(RefundRangeSchema.safeParse(range).success).toBe(false))
  it('accepts a single Korea business day', () => expect(RefundRangeSchema.safeParse({ from: '2026-09-18', to: '2026-09-18' }).success).toBe(true))
})
describe('credential-free refund recovery storage', () => {
  it('persists only opaque sale and request identifiers', () => { const s = storage(); saveRefundRecovery(s, id, other); expect(JSON.parse(s.data.get(REFUND_RECOVERY_KEY)!)).toEqual({ saleId: id, idempotencyKey: other }); expect(readRefundRecovery(s)).toEqual({ saleId: id, idempotencyKey: other }); clearRefundRecovery(s); expect(readRefundRecovery(s)).toBeNull() })
  it('fails closed on malformed recovery, without silently dropping it', () => { const s = storage(); s.data.set(REFUND_RECOVERY_KEY, 'broken'); expect(() => readRefundRecovery(s)).toThrow(); expect(s.data.has(REFUND_RECOVERY_KEY)).toBe(true) })
  it('rejects appended private fields', () => { const s = storage(); s.data.set(REFUND_RECOVERY_KEY, JSON.stringify({ saleId: id, idempotencyKey: other, name: 'Do not persist names' })); expect(() => readRefundRecovery(s)).toThrow() })
  it('refuses submissions when storage cannot be read back', () => expect(() => saveRefundRecovery({ getItem: () => null, setItem: () => {}, removeItem: () => {} }, id, other)).toThrow('unavailable'))
  it('rejects non-UUID references before writing', () => { const s = storage(); expect(() => saveRefundRecovery(s, 'invalid', other)).toThrow(); expect(s.data.size).toBe(0) })
})
