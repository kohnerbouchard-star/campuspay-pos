import { describe, expect, it } from 'vitest'
import { previewTender } from '@/features/pos/tender'
import { ConfirmPaymentSchema, CreatePaymentIntentSchema } from '@/features/pos/domain'

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
  it('requires a positive contribution for split creation', () => {
    expect(CreatePaymentIntentSchema.safeParse({ items: [{ productId: 'e3e23304-f1df-471a-80db-bc88e338ef41', quantity: 1 }], idempotencyKey: 'e3e23304-f1df-471a-80db-bc88e338ef42', tenderMode: 'SPLIT' }).success).toBe(false)
  })
})
