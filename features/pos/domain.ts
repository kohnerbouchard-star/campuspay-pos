import { z } from 'zod'
import { CouponCodeSchema } from '@/features/coupons/domain'

export const CatalogProductSchema = z.object({
  id: z.string().uuid(),
  sku: z.string(),
  name: z.string(),
  category: z.string(),
  selling_price_won: z.number().int().nonnegative(),
  stock_on_hand: z.number().int().nonnegative(),
  sold_out: z.boolean(),
})
export type CatalogProduct = z.infer<typeof CatalogProductSchema>

export const CatalogSchema = z.array(CatalogProductSchema)

export const CartLineSchema = z.object({
  productId: z.string().uuid(),
  quantity: z.number().int().min(1).max(99),
})
export type CartLine = z.infer<typeof CartLineSchema>

export const CreatePaymentIntentSchema = z.object({
  items: z.array(CartLineSchema).min(1).max(50),
  couponCode: CouponCodeSchema.nullable().optional(),
  idempotencyKey: z.string().uuid(),
})

export const PaymentIntentSchema = z.object({
  intent_id: z.string().uuid(),
  state: z.enum(['awaiting_card', 'awaiting_pin', 'completed', 'cancelled', 'expired']),
  subtotal_won: z.number().int().positive(),
  discount_won: z.number().int().nonnegative(),
  total_won: z.number().int().nonnegative(),
  coupon_name: z.string().nullable(),
  coupon_code_masked: z.string().nullable(),
  expires_at: z.string(),
})
export type PaymentIntent = z.infer<typeof PaymentIntentSchema>

export const ScanCardSchema = z.object({ cardRead: z.string().min(1).max(128) })
export const CardScanResultSchema = z.object({
  intent_id: z.string().uuid(),
  state: z.literal('awaiting_pin'),
  student_display_name: z.string(),
  current_balance_won: z.number().int(),
  projected_balance_won: z.number().int(),
  projected_debt_won: z.number().int().nonnegative(),
  expires_at: z.string(),
})
export type CardScanResult = z.infer<typeof CardScanResultSchema>

export const ConfirmPaymentSchema = z.object({
  pin: z.string().min(4).max(12).regex(/^\d+$/),
})

export const PaymentDecisionSchema = z.object({
  approved: z.boolean(),
  error_code: z.string().nullable(),
  sale_id: z.string().uuid().nullable(),
  receipt_number: z.string().nullable(),
  subtotal_won: z.number().int().nullable(),
  discount_won: z.number().int().nullable(),
  total_won: z.number().int().nullable(),
  coupon_name: z.string().nullable(),
  coupon_code_masked: z.string().nullable(),
  balance_before_won: z.number().int().nullable(),
  balance_after_won: z.number().int().nullable(),
  debt_after_won: z.number().int().nonnegative().nullable(),
  cogs_won: z.number().int().nonnegative().nullable(),
  created_at: z.string(),
})

export const PaymentReceiptSchema = z.object({
  sale_id: z.string().uuid(),
  receipt_number: z.string(),
  subtotal_won: z.number().int().positive(),
  discount_won: z.number().int().nonnegative(),
  total_won: z.number().int().nonnegative(),
  coupon_name: z.string().nullable(),
  coupon_code_masked: z.string().nullable(),
  balance_before_won: z.number().int(),
  balance_after_won: z.number().int(),
  debt_after_won: z.number().int().nonnegative(),
  cogs_won: z.number().int().nonnegative(),
  created_at: z.string(),
})
export type PaymentReceipt = z.infer<typeof PaymentReceiptSchema>
