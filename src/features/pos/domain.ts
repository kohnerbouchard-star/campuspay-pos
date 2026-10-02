import { z } from 'zod'
import { eventPaymentIssue } from './payment-policy-validation'
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

export const TenderModeSchema = z.enum(['WALLET', 'CASH', 'SPLIT'])
export type TenderMode = z.infer<typeof TenderModeSchema>
export const PaymentPolicySchema = z.object({
  terminal_label: z.string(), cash_enabled: z.boolean(), event_name: z.string().nullable(), can_manage: z.boolean(),
  ends_at: z.string().nullable(), event_status: z.enum(['OFF', 'ACTIVE', 'EXPIRED']),
})
export type PaymentPolicy = z.infer<typeof PaymentPolicySchema>
export const UpdatePaymentPolicySchema = z.object({
  cashEnabled: z.boolean(), eventName: z.string().trim().max(80).nullable(),
  endsAt: z.iso.datetime().nullable().optional(),
}).superRefine((value, context) => {
  const issue = value.cashEnabled ? eventPaymentIssue(value.eventName, value.endsAt) : null
  if (issue) context.addIssue({ code: 'custom', message: issue.message, path: [issue.field] })
})

export const CreatePaymentIntentSchema = z.object({
  items: z.array(CartLineSchema).min(1).max(50),
  couponCode: CouponCodeSchema.nullable().optional(),
  idempotencyKey: z.string().uuid(),
  tenderMode: TenderModeSchema.default('WALLET'),
  walletAmountWon: z.number().int().positive().max(1000000000).nullable().optional(),
})
export const FinalizeTenderSchema = z.object({ walletAmountWon: z.number().int().positive().max(1000000000) }).strict()

export const PaymentIntentSchema = z.object({
  intent_id: z.string().uuid(),
  state: z.enum(['awaiting_card', 'awaiting_pin', 'completed', 'cancelled', 'expired']),
  subtotal_won: z.number().int().positive(),
  discount_won: z.number().int().nonnegative(),
  total_won: z.number().int().nonnegative(),
  coupon_name: z.string().nullable(),
  coupon_code_masked: z.string().nullable(),
  expires_at: z.string(),
  tender_mode: TenderModeSchema,
  wallet_tender_won: z.number().int().nonnegative().nullable(),
  cash_tender_won: z.number().int().nonnegative().nullable(),
})
export type PaymentIntent = z.infer<typeof PaymentIntentSchema>

export const ScanCardSchema = z.object({ cardRead: z.string().min(1).max(128) })
export const CardScanResultSchema = z.object({
  intent_id: z.string().uuid(),
  state: z.literal('awaiting_pin'),
  student_display_name: z.string(),
  current_balance_won: z.number().int(),
  minimum_balance_won: z.number().int(),
  maximum_wallet_won: z.number().int().nonnegative(),
  projected_balance_won: z.number().int(),
  projected_debt_won: z.number().int().nonnegative(),
  expires_at: z.string(),
})
export type CardScanResult = z.infer<typeof CardScanResultSchema>

export const ConfirmPaymentSchema = z.object({
  pin: z.string().min(4).max(12).regex(/^\d+$/).nullable().optional(),
  cashReceivedWon: z.number().int().nonnegative().max(1000000000).nullable().optional(),
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
  tender_mode: TenderModeSchema,
  wallet_tender_won: z.number().int().nonnegative(),
  cash_tender_won: z.number().int().nonnegative(),
  cash_received_won: z.number().int().nonnegative().nullable(),
  change_given_won: z.number().int().nonnegative().nullable(),
})

export const PaymentReceiptSchema = z.object({
  sale_id: z.string().uuid(),
  receipt_number: z.string(),
  subtotal_won: z.number().int().positive(),
  discount_won: z.number().int().nonnegative(),
  total_won: z.number().int().nonnegative(),
  coupon_name: z.string().nullable(),
  coupon_code_masked: z.string().nullable(),
  balance_before_won: z.number().int().nullable(),
  balance_after_won: z.number().int().nullable(),
  debt_after_won: z.number().int().nonnegative().nullable(),
  cogs_won: z.number().int().nonnegative(),
  created_at: z.string(),
  tender_mode: TenderModeSchema,
  wallet_tender_won: z.number().int().nonnegative(),
  cash_tender_won: z.number().int().nonnegative(),
  cash_received_won: z.number().int().nonnegative().nullable(),
  change_given_won: z.number().int().nonnegative().nullable(),
})
export type PaymentReceipt = z.infer<typeof PaymentReceiptSchema>

export const PaymentRecoverySchema = z.object({
  state: z.enum(['completed', 'cancelled']), receipt: PaymentReceiptSchema.nullable(),
  items: z.array(z.object({ name: z.string(), quantity: z.number().int().positive(), lineTotalWon: z.number().int().nonnegative() })),
})
export type PaymentRecovery = z.infer<typeof PaymentRecoverySchema>
