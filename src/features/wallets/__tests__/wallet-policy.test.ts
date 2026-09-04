import { describe, expect, it } from 'vitest'
import { adjustmentTotal, debtFromBalance, projectedWalletBalance } from '@/features/wallets/denominations'

describe('wallet policy', () => {
  it('approves a sale that ends exactly at the floor', () => {
    expect(projectedWalletBalance(-10_000, 'DEBIT', 5_000)).toBe(-15_000)
  })

  it('identifies a balance below the floor', () => {
    expect(projectedWalletBalance(-10_000, 'DEBIT', 5_001)).toBeLessThan(-15_000)
  })

  it('uses a negative balance as debt', () => {
    expect(debtFromBalance(-6_200)).toBe(6_200)
    expect(debtFromBalance(3_800)).toBe(0)
  })

  it('accepts only predefined denominations', () => {
    expect(adjustmentTotal([20_000, 10_000])).toBe(30_000)
    expect(() => adjustmentTotal([7_500])).toThrow('predefined denominations')
  })
})
