import { z } from 'zod'
export const READINESS_FEATURES = ['refunds', 'returns', 'cash_controls', 'administration', 'partial_refund_preview', 'partial_refunds', 'funding'] as const
export const ReadinessDatabaseSchema = z.object({
  features: z.object({ refunds: z.boolean(), returns: z.boolean(), cash_controls: z.boolean(), administration: z.boolean(), partial_refund_preview: z.boolean(), partial_refunds: z.boolean(), funding: z.boolean() }),
  active_card_missing_pin: z.number().int().nonnegative(),
  receipt_cost_mismatches: z.number().int().nonnegative(),
})
export type InstallationReadiness = {
  features: { name: string; application: boolean; database: boolean; effective: boolean }[]
  active_card_missing_pin: number
  receipt_cost_mismatches: number
}
