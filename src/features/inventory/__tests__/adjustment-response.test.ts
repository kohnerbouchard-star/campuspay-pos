import { describe, expect, it } from 'vitest'
import { StockAdjustmentRecoverySchema, StockAdjustmentResultSchema } from '../domain'
const posted = { idempotency_key: '01234567-1234-4234-8234-0123456789ab', reference_id: '01234567-1234-4234-8234-0123456789ac', reference_number: 'ADJ-20261007-000123', created_at: '2026-10-07T10:00:00+00:00' }
describe('stock recovery evidence boundary', () => {
  it('requires an authoritative reference and timestamp before accepting a success', () => {
    expect(StockAdjustmentResultSchema.safeParse(posted).success).toBe(true)
    for (const change of [{ reference_number: '' }, { created_at: '' }, { idempotency_key: undefined }, { reference_id: 'missing' }, { extra: 'untrusted' }]) {
      expect(StockAdjustmentResultSchema.safeParse({ ...posted, ...change }).success).toBe(false)
    }
  })
  it('distinguishes posted from atomically closed; missing, partial and contradictory evidence fails closed', () => {
    expect(StockAdjustmentRecoverySchema.safeParse({ state: 'POSTED', ...posted, quantity_removed: 1, total_cost_won: 120 }).success).toBe(true)
    expect(StockAdjustmentRecoverySchema.safeParse({ state: 'CLOSED', idempotency_key: posted.idempotency_key }).success).toBe(true)
    for (const value of [null, {}, { state: 'CLOSED' }, { state: 'CLOSED', ...posted }, { state: 'POSTED', ...posted }, { state: 'NOT_FOUND', idempotency_key: posted.idempotency_key }]) {
      expect(StockAdjustmentRecoverySchema.safeParse(value).success).toBe(false)
    }
  })
})
