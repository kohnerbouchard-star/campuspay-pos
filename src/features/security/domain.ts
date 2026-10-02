import { z } from 'zod'

export const StepUpSchema = z.object({
  superAdminEmployeeCode: z.string().trim().min(2).max(32),
  superAdminPin: z.string().min(4).max(16).regex(/^\d+$/),
  purpose: z.enum(['RESET_STUDENT_PIN', 'RESET_STUDENT_CARD', 'COMPLETE_STUDENT_PIN']),
  studentId: z.string().uuid(),
})
export const StepUpResultSchema = z.object({
  authorizationToken: z.string().min(32),
  expiresAt: z.string(),
})

export const ResetPinSchema = z.object({
  authorizationToken: z.string().min(32),
  newPin: z.string().min(4).max(12).regex(/^\d+$/),
  confirmationPin: z.string().min(4).max(12).regex(/^\d+$/),
}).refine((value) => value.newPin === value.confirmationPin, { message: 'PIN entries do not match' })

export const CompleteMissingPinSchema = z.object({
  authorizationToken: z.string().min(32),
  newPin: z.string().regex(/^\d{4,12}$/),
  confirmationPin: z.string().regex(/^\d{4,12}$/),
  identityVerified: z.literal(true),
}).strict().refine(value => value.newPin === value.confirmationPin, { message: 'PIN entries do not match' })

export const ResetCardSchema = z.object({
  authorizationToken: z.string().min(32),
  newCardRead: z.string().min(6).max(128).regex(/^[A-Za-z0-9:-]+$/)
    .refine((value) => value.replace(/[^a-zA-Z0-9]/g, '').length >= 6 && value.replace(/[^a-zA-Z0-9]/g, '').length <= 64),
})

export const ResetResultSchema = z.object({
  audit_reference: z.string(),
  completed_at: z.string(),
})

export const SecurityStudentSchema = z.object({
  student_id: z.string().uuid(),
  student_code: z.string(),
  display_name: z.string(),
  card_active: z.boolean(),
  pin_set: z.boolean(),
  credential_state: z.enum(['ROSTER_ONLY', 'CARD_ONLY', 'READY', 'CARD_REQUIRED', 'INCOMPLETE', 'INACTIVE']),
})
export type SecurityStudent = z.infer<typeof SecurityStudentSchema>
