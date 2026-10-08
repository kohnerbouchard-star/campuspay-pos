import { describe, expect, it } from 'vitest'
import { CartLineSchema } from '@/features/pos/domain'
import { MAX_CART_QUANTITY } from '@/features/pos/quantity'
describe('checkout quantity server contract', () => {
  const productId = '11111111-1111-4111-8111-111111111111'
  it.each([1, 98, 99])('accepts integral quantity %s', quantity => {
    expect(CartLineSchema.safeParse({ productId, quantity }).success).toBe(true)
  })
  it.each([-1, 0, 100, 10000, 1.5, NaN, Infinity])('rejects quantity %s', quantity => {
    expect(CartLineSchema.safeParse({ productId, quantity }).success).toBe(false)
  })
  it('retains the existing server limit', () => expect(MAX_CART_QUANTITY).toBe(99))
})
