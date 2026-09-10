import { describe, expect, it } from 'vitest'
import { previewTender, validSplitContribution } from '@/features/pos/tender'
import { ConfirmPaymentSchema, CreatePaymentIntentSchema, UpdatePaymentPolicySchema } from '@/features/pos/domain'

describe('tender proposal validation', () => {
  it('previews the exact 12000 / 7000 wallet / 5000 cash case without treating received cash as revenue', () => {
    expect(previewTender(12000, 'SPLIT', '7000', '10000')).toEqual({ walletWon: 7000, cashDueWon: 5000, cashReceivedWon: 10000, changeWon: 5000, validWallet: true, validCash: true })
  })
  it('rejects insufficient cash while keeping the wallet contribution a proposal', () => {
    expect(previewTender(12000, 'SPLIT', '7000', '4000').validCash).toBe(false)
  })
  it.each(['0', '12000', '13000', '-1', '1.5', '', 'Infinity'])('rejects invalid split contribution %s', value => {
    expect(previewTender(12000, 'SPLIT', value, '12000').validWallet).toBe(false)
  })
  it('accepts cardless exact cash and wallet-only without cash', () => {
    expect(previewTender(7500, 'CASH', '', '7500').validCash).toBe(true)
    expect(previewTender(7500, 'WALLET', '', '').cashDueWon).toBe(0)
    expect(ConfirmPaymentSchema.parse({ cashReceivedWon: 10000 }).pin).toBeUndefined()
  })
  it('starts split without a guessed contribution before card identification', () => {
    expect(CreatePaymentIntentSchema.safeParse({ items: [{ productId: 'e3e23304-f1df-471a-80db-bc88e338ef41', quantity: 1 }], idempotencyKey: 'e3e23304-f1df-471a-80db-bc88e338ef42', tenderMode: 'SPLIT' }).success).toBe(true)
  })
})

describe('card-identified split contribution', () => {
  it.each(['0', '10001', '12000', '13000', '-1', '1.5', ''])('rejects invalid or above-capacity amount %s', value => { expect(validSplitContribution(12000, 10000, value)).toBe(false) })
  it('accepts maximum and smaller manual amounts', () => { expect(validSplitContribution(25000, 18000, '18000')).toBe(true); expect(validSplitContribution(12000, 10000, '7000')).toBe(true) })
})
describe('event expiry input', () => {
  it('requires a future end no later than 24 hours', () => {
    for (const endsAt of [null, new Date(Date.now() - 1000).toISOString(), new Date(Date.now() + 25 * 3600000).toISOString()]) expect(UpdatePaymentPolicySchema.safeParse({ cashEnabled: true, eventName: 'Festival', endsAt }).success).toBe(false)
    expect(UpdatePaymentPolicySchema.safeParse({ cashEnabled: true, eventName: 'Festival', endsAt: new Date(Date.now() + 3600000).toISOString() }).success).toBe(true)
  })
  it('can disable an event without supplying an end', () => { expect(UpdatePaymentPolicySchema.safeParse({ cashEnabled: false, eventName: null }).success).toBe(true) })
})
