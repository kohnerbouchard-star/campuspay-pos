import { z } from 'zod'

export const CashReadinessSchema = z.object({
  state: z.enum(['READY','NO_CASH_DUE','PAID','ISSUE_PERMISSION_REQUIRED','PAYOUT_PERMISSION_REQUIRED','WRONG_TERMINAL','CASH_SHIFT_REQUIRED','DRAWER_OWNER_REQUIRED','PAYOUT_OPERATOR_REQUIRED']),
  sale_id: z.string().uuid(), refund_id: z.string().uuid().nullable(), terminal_id: z.string().uuid(), handoff: z.boolean(),
})
export type CashReadiness = z.infer<typeof CashReadinessSchema>
export const CASH_READINESS_MESSAGES: Record<CashReadiness['state'], string> = {
  READY: 'Cash handover can be recorded at this register. Verify the receipt and pay only once.',
  NO_CASH_DUE: 'No cash handover is required.',
  PAID: 'A cash handover is already recorded. Refresh the receipt; do not pay again.',
  ISSUE_PERMISSION_REQUIRED: 'Refund issue access is required.',
  PAYOUT_PERMISSION_REQUIRED: 'Ask an authorized payout operator to sign in at the refund’s original register. Do not hand over cash yet.',
  WRONG_TERMINAL: 'Use the register where this refund was issued. Do not hand over cash at this register.',
  CASH_SHIFT_REQUIRED: 'Open an authorized cash drawer at this register before proceeding. Do not hand over cash yet.',
  DRAWER_OWNER_REQUIRED: 'Use the drawer owner or an operator with explicit drawer override access. Do not hand over cash yet.',
  PAYOUT_OPERATOR_REQUIRED: 'An authorized payout operator must be available for this register’s drawer before a cash refund is issued.',
}
