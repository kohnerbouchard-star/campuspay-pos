import { z } from 'zod'

export const CouponDiscountTypeSchema = z.enum(['FIXED', 'PERCENTAGE'])
export type CouponDiscountType = z.infer<typeof CouponDiscountTypeSchema>

export const CouponCodeSchema = z.string()
  .trim()
  .min(4)
  .max(40)
  .regex(/^[A-Za-z0-9\s-]+$/, 'Coupon codes may contain letters, numbers, spaces, and hyphens only')
  .refine((value) => {
    const compact = value.replace(/[\s-]+/g, '')
    return compact.length >= 4 && compact.length <= 32
  }, 'Coupon code must contain 4–32 letters or numbers')

const NullablePositiveInteger = z.number().int().positive().nullable()

export const CreateCouponSchema = z.object({
  name: z.string().trim().min(2).max(120),
  code: CouponCodeSchema,
  discountType: CouponDiscountTypeSchema,
  fixedAmountWon: z.number().int().positive().nullable(),
  percentageBps: z.number().int().min(1).max(10_000).nullable(),
  minimumSubtotalWon: z.number().int().nonnegative().default(0),
  maxDiscountWon: NullablePositiveInteger,
  totalRedemptionLimit: NullablePositiveInteger,
  perStudentLimit: NullablePositiveInteger,
  startsAt: z.string().datetime({ offset: true }),
  endsAt: z.string().datetime({ offset: true }).nullable(),
  idempotencyKey: z.string().uuid(),
}).superRefine((value, ctx) => {
  if (value.discountType === 'FIXED') {
    if (value.fixedAmountWon === null) {
      ctx.addIssue({ code: 'custom', path: ['fixedAmountWon'], message: 'Fixed coupons require an amount' })
    }
    if (value.percentageBps !== null) {
      ctx.addIssue({ code: 'custom', path: ['percentageBps'], message: 'Fixed coupons cannot include a percentage' })
    }
  } else {
    if (value.percentageBps === null) {
      ctx.addIssue({ code: 'custom', path: ['percentageBps'], message: 'Percentage coupons require a rate' })
    }
    if (value.fixedAmountWon !== null) {
      ctx.addIssue({ code: 'custom', path: ['fixedAmountWon'], message: 'Percentage coupons cannot include a fixed amount' })
    }
  }

  if (value.endsAt !== null && new Date(value.endsAt).getTime() <= new Date(value.startsAt).getTime()) {
    ctx.addIssue({ code: 'custom', path: ['endsAt'], message: 'End time must be after start time' })
  }
})
export type CreateCouponInput = z.infer<typeof CreateCouponSchema>

export const CouponSummarySchema = z.object({
  coupon_id: z.string().uuid(),
  name: z.string(),
  code_masked: z.string(),
  discount_type: CouponDiscountTypeSchema,
  fixed_amount_won: z.number().int().nullable(),
  percentage_bps: z.number().int().nullable(),
  minimum_subtotal_won: z.number().int().nonnegative(),
  max_discount_won: z.number().int().positive().nullable(),
  total_redemption_limit: z.number().int().positive().nullable(),
  per_student_limit: z.number().int().positive().nullable(),
  redemption_count: z.number().int().nonnegative(),
  discount_given_won: z.number().int().nonnegative(),
  starts_at: z.string(),
  ends_at: z.string().nullable(),
  active: z.boolean(),
  created_at: z.string(),
})
export type CouponSummary = z.infer<typeof CouponSummarySchema>
export const CouponListSchema = z.array(CouponSummarySchema)

export const CouponMutationResultSchema = z.object({
  coupon_id: z.string().uuid(),
  name: z.string(),
  code_masked: z.string(),
  active: z.boolean(),
  created_at: z.string(),
})
export type CouponMutationResult = z.infer<typeof CouponMutationResultSchema>

export const DeactivateCouponSchema = z.object({
  reason: z.string().trim().min(3).max(250),
})

export const QuoteCouponSchema = z.object({
  items: z.array(z.object({
    productId: z.string().uuid(),
    quantity: z.number().int().min(1).max(99),
  })).min(1).max(50),
  code: CouponCodeSchema,
})

export const CouponQuoteSchema = z.object({
  coupon_id: z.string().uuid(),
  coupon_name: z.string(),
  code_masked: z.string(),
  subtotal_won: z.number().int().positive(),
  discount_won: z.number().int().positive(),
  total_won: z.number().int().nonnegative(),
})
export type CouponQuote = z.infer<typeof CouponQuoteSchema>
