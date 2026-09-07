import { afterEach, describe, expect, it, vi } from 'vitest'
import { clearPendingOrder, parsePendingOrder, readPendingOrder, savePendingOrder, type RecoverableOrder } from '@/features/store/order-recovery'

const student = '00000000-0000-4000-8000-000000000001'
const another = '00000000-0000-4000-8000-000000000002'
const order: RecoverableOrder = {
  input: { items: [{ productId: '00000000-0000-4000-8000-000000000003', quantity: 1 }], couponCode: null, deliveryLocationId: '00000000-0000-4000-8000-000000000004', deliveryNote: 'Room delivery' },
  quote: { subtotal_won: 1200, discount_won: 0, total_won: 1200, balance_before_won: 15000, balance_after_won: 13800, coupon_name: null, coupon_code_masked: null },
  idempotencyKey: '00000000-0000-4000-8000-000000000005',
}
afterEach(() => vi.unstubAllGlobals())
describe('online order recovery', () => {
  it('retains the exact payment UUID and proposal across component loss and reauthentication', () => {
    const data = new Map<string, string>()
    vi.stubGlobal('window', { sessionStorage: { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => data.set(key, value), removeItem: (key: string) => data.delete(key) } })
    savePendingOrder(student, order)
    expect(readPendingOrder(student)).toEqual(order)
    expect(readPendingOrder(another)).toBeNull()
    expect(JSON.stringify([...data.values()])).not.toMatch(/pin|cardNumber|sessionToken/)
    // Replaying after a reload submits the original UUID; only success removes it.
    expect(readPendingOrder(student)?.idempotencyKey).toBe(order.idempotencyKey)
    clearPendingOrder(student)
    expect(readPendingOrder(student)).toBeNull()
  })
  it('binds recovery to one student and rejects malformed storage', () => {
    const raw = JSON.stringify({ version: 1, studentId: student, order })
    expect(parsePendingOrder(raw, another)).toBeNull()
    expect(parsePendingOrder('{broken', student)).toBeNull()
    expect(parsePendingOrder(JSON.stringify({ version: 1, studentId: student, order: { ...order, idempotencyKey: 'invalid' } }), student)).toBeNull()
  })
  it('fails before payment begins when the browser cannot persist recovery', () => {
    vi.stubGlobal('window', { sessionStorage: { setItem: () => { throw new Error('Storage unavailable') } } })
    expect(() => savePendingOrder(student, order)).toThrow('Storage unavailable')
  })
})
