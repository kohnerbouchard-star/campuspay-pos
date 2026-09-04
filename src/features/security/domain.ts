import { z } from 'zod'

export const StepUpSchema = z.object({
  superAdminEmployeeCode: z.string().trim().min(2).max(32),
  superAdminPin: z.string().min(4).max(16).regex(/^\d+$/),
  purpose: z.enum(['RESET_STUDENT_PIN', 'RESET_STUDENT_CARD']),
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

export const ResetCardSchema = z.object({
  authorizationToken: z.string().min(32),
  newCardRead: z.string().min(1).max(128),
})

export const ResetResultSchema = z.object({
  audit_reference: z.string(),
  completed_at: z.string(),
})
