import type { CouponDiscountType } from '@/features/coupons/domain'

export function calculateCouponDiscount(input: {
  subtotalWon: number
  discountType: CouponDiscountType
  fixedAmountWon: number | null
  percentageBps: number | null
  maxDiscountWon: number | null
}): number {
  const { subtotalWon, discountType, fixedAmountWon, percentageBps, maxDiscountWon } = input
  if (!Number.isInteger(subtotalWon) || subtotalWon <= 0) return 0

  const raw = discountType === 'FIXED'
    ? Math.max(0, fixedAmountWon ?? 0)
    : Math.max(1, Math.floor(subtotalWon * Math.max(0, percentageBps ?? 0) / 10_000))

  const capped = maxDiscountWon === null ? raw : Math.min(raw, maxDiscountWon)
  return Math.min(subtotalWon, Math.max(0, Math.floor(capped)))
}
