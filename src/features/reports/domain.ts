import { z } from 'zod'

export const ReportRangeSchema = z.object({
  from: z.string().date().optional(),
  to: z.string().date().optional(),
})

export const SalesReportRowSchema = z.object({
  receipt_number: z.string(),
  sold_at: z.string(),
  cashier_name: z.string(),
  channel: z.enum(['POS', 'ONLINE_STORE']),
  subtotal_won: z.number().int(),
  discount_won: z.number().int(),
  revenue_won: z.number().int(),
  cogs_won: z.number().int(),
  gross_profit_won: z.number().int(),
  coupon_name: z.string().nullable(),
  coupon_code_masked: z.string().nullable(),
  student_name: z.string(),
  balance_after_won: z.number().int(),
})
export const SalesReportSchema = z.array(SalesReportRowSchema)

export const InventoryReportRowSchema = z.object({
  product_name: z.string(), sku: z.string(), quantity_on_hand: z.number().int(),
  inventory_value_won: z.number().int(), reorder_level: z.number().int(),
  low_stock: z.boolean(),
})
export const InventoryReportSchema = z.array(InventoryReportRowSchema)

export const WalletReportRowSchema = z.object({
  student_code: z.string(), display_name: z.string(), balance_won: z.number().int(),
  debt_won: z.number().int().nonnegative(), last_changed_at: z.string().nullable(),
})
export const WalletReportSchema = z.array(WalletReportRowSchema)

export const CouponReportRowSchema = z.object({
  coupon_name: z.string(),
  code_masked: z.string(),
  redemption_count: z.number().int().nonnegative(),
  discount_given_won: z.number().int().nonnegative(),
  sales_revenue_won: z.number().int().nonnegative(),
  last_redeemed_at: z.string().nullable(),
})
export type CouponReportRow = z.infer<typeof CouponReportRowSchema>
export const CouponReportSchema = z.array(CouponReportRowSchema)
