import { z } from 'zod'

export const ALLOWED_DENOMINATIONS_WON = [1000, 5000, 10000, 20000, 50000] as const
const DenominationSchema = z.union([
  z.literal(1000), z.literal(5000), z.literal(10000), z.literal(20000), z.literal(50000),
])

export const StudentWalletSummarySchema = z.object({
  student_id: z.string().uuid(),
  student_code: z.string(),
  display_name: z.string(),
  balance_won: z.number().int(),
  debt_won: z.number().int().nonnegative(),
  card_active: z.boolean(),
})
export type StudentWalletSummary = z.infer<typeof StudentWalletSummarySchema>
export const StudentWalletSearchSchema = z.array(StudentWalletSummarySchema)

export const CreateAdjustmentIntentSchema = z.object({
  direction: z.enum(['CREDIT', 'DEBIT']),
  denominations: z.array(DenominationSchema).min(1).max(30),
  reasonCode: z.enum(['FUNDS_RECEIVED', 'PURCHASE_CORRECTION', 'DUPLICATE_CREDIT_REVERSAL', 'ADMINISTRATIVE_CHARGE', 'OTHER_APPROVED_CORRECTION']),
  notes: z.string().trim().min(3).max(500),
  idempotencyKey: z.string().uuid(),
})

export const AdjustmentIntentSchema = z.object({
  intent_id: z.string().uuid(),
  amount_won: z.number().int().positive(),
  state: z.enum(['awaiting_card', 'awaiting_pin', 'completed', 'cancelled', 'expired']),
  expires_at: z.string(),
})
export type AdjustmentIntent = z.infer<typeof AdjustmentIntentSchema>

export const AdjustmentCardResultSchema = z.object({
  intent_id: z.string().uuid(),
  state: z.literal('awaiting_pin'),
  student_display_name: z.string(),
  current_balance_won: z.number().int(),
  projected_balance_won: z.number().int(),
  projected_debt_won: z.number().int().nonnegative(),
})
export type AdjustmentCardResult = z.infer<typeof AdjustmentCardResultSchema>

export const AdjustmentDecisionSchema = z.object({
  approved: z.boolean(),
  error_code: z.string().nullable(),
  reference_number: z.string().nullable(),
  amount_won: z.number().int().nullable(),
  balance_before_won: z.number().int().nullable(),
  balance_after_won: z.number().int().nullable(),
  debt_after_won: z.number().int().nonnegative().nullable(),
  created_at: z.string(),
})

export const AdjustmentReceiptSchema = z.object({
  reference_number: z.string(),
  amount_won: z.number().int(),
  balance_before_won: z.number().int(),
  balance_after_won: z.number().int(),
  debt_after_won: z.number().int().nonnegative(),
  created_at: z.string(),
})
export type AdjustmentReceipt = z.infer<typeof AdjustmentReceiptSchema>

export const WalletTransactionSchema = z.object({
  reference_number: z.string(), amount_won: z.number().int(), balance_before_won: z.number().int(), balance_after_won: z.number().int(),
  entry_type: z.string(), reason_code: z.string(), notes: z.string().nullable(), created_at: z.string(), actor_name: z.string(),
})
export type WalletTransaction = z.infer<typeof WalletTransactionSchema>
