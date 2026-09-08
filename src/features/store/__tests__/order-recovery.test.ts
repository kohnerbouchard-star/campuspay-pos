import { afterEach, describe, expect, it, vi } from 'vitest'
import { clearPendingOrder, parsePendingOrder, readPendingOrder, savePendingOrder, scrubPendingOrderStorage, type RecoverableOrder } from '@/features/store/order-recovery'

const student = '00000000-0000-4000-8000-000000000001'
const another = '00000000-0000-4000-8000-000000000002'
const order: RecoverableOrder = {
  idempotencyKey: '00000000-0000-4000-8000-000000000005',
}
afterEach(() => vi.unstubAllGlobals())
describe('online order recovery', () => {
  it('scrubs personal proposal data for every student while preserving only unresolved opaque keys', () => {
    const storage: Record<string, string> = {
      [`mica-money:pending-order:${student}`]: JSON.stringify({ version: 1, studentId: student, order: { ...order, input: { deliveryNote: 'Private room note', couponCode: 'PRIVATECODE' }, quote: { balance_before_won: 12345 } } }),
      [`mica-money:pending-order:${another}`]: JSON.stringify({ version: 1, studentId: another, order: { ...order, input: { deliveryNote: 'Other student note' } } }),
      'mica-money:pending-order:stale': '{invalid',
    }
    Object.defineProperties(storage, {
      getItem: { value: (key: string) => storage[key] ?? null },
      setItem: { value: (key: string, value: string) => { storage[key] = value } },
      removeItem: { value: (key: string) => { delete storage[key] } },
    })
    vi.stubGlobal('window', { sessionStorage: storage })
    scrubPendingOrderStorage()
    expect(Object.keys(storage)).toHaveLength(2)
    expect(JSON.stringify(storage)).not.toMatch(/Private|Other student|PRIVATECODE|balance|deliveryNote|quote|input/)
    expect(readPendingOrder(student)).toEqual(order)
    expect(Object.keys(JSON.parse(storage[`mica-money:pending-order:${another}`])).sort()).toEqual(['idempotencyKey', 'studentId', 'version'])
    clearPendingOrder(student)
    expect(readPendingOrder(student)).toBeNull()
    expect(readPendingOrder(another)).toEqual(order)
  })
  it('retains only the opaque payment UUID across component loss and reauthentication', () => {
    const data = new Map<string, string>()
    vi.stubGlobal('window', { sessionStorage: { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => data.set(key, value), removeItem: (key: string) => data.delete(key) } })
    savePendingOrder(student, order)
    expect(readPendingOrder(student)).toEqual(order)
    expect(readPendingOrder(another)).toBeNull()
    expect(JSON.stringify([...data.values()])).not.toMatch(/pin|cardNumber|sessionToken/)
    // Recovery after a reload uses the original UUID; a known outcome removes it.
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
