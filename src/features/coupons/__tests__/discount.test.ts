import { describe, expect, it } from 'vitest'
import { calculateCouponDiscount } from '@/features/coupons/discount'

const base = { subtotalWon: 10_000, maxDiscountWon: null as number | null }

describe('coupon discount policy', () => {
  it('caps a fixed coupon at the order subtotal', () => {
    expect(calculateCouponDiscount({ ...base, discountType: 'FIXED', fixedAmountWon: 20_000, percentageBps: null })).toBe(10_000)
  })

  it('calculates percentage coupons in basis points', () => {
    expect(calculateCouponDiscount({ ...base, discountType: 'PERCENTAGE', fixedAmountWon: null, percentageBps: 1_500 })).toBe(1_500)
  })

  it('applies a maximum discount cap', () => {
    expect(calculateCouponDiscount({ ...base, discountType: 'PERCENTAGE', fixedAmountWon: null, percentageBps: 5_000, maxDiscountWon: 2_000 })).toBe(2_000)
  })
})
