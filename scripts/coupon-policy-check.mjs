import assert from 'node:assert/strict'
import { calculateCouponDiscount } from '../src/features/coupons/discount.ts'

assert.equal(calculateCouponDiscount({
  subtotalWon: 10_000,
  discountType: 'FIXED',
  fixedAmountWon: 20_000,
  percentageBps: null,
  maxDiscountWon: null,
}), 10_000, 'fixed discounts must cap at the subtotal')

assert.equal(calculateCouponDiscount({
  subtotalWon: 10_000,
  discountType: 'PERCENTAGE',
  fixedAmountWon: null,
  percentageBps: 1_500,
  maxDiscountWon: null,
}), 1_500, 'percentage coupons must use basis points')

assert.equal(calculateCouponDiscount({
  subtotalWon: 10_000,
  discountType: 'PERCENTAGE',
  fixedAmountWon: null,
  percentageBps: 5_000,
  maxDiscountWon: 2_000,
}), 2_000, 'percentage coupons must respect the maximum discount')

assert.equal(calculateCouponDiscount({
  subtotalWon: 750,
  discountType: 'PERCENTAGE',
  fixedAmountWon: null,
  percentageBps: 1,
  maxDiscountWon: null,
}), 1, 'a valid percentage coupon must produce at least a one-won discount')

console.log('Coupon policy runtime checks passed.')
