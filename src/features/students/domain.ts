import { z } from 'zod'

export const EnrollmentSchema = z.object({
  studentCode: z.string().trim().min(1).max(40).regex(/^[A-Za-z0-9_-]+$/),
  displayName: z.string().trim().min(1).max(120).refine((value) => !/[\u0000-\u001f\u007f]/.test(value)),
  cardRead: z.string().min(6).max(128).regex(/^[A-Za-z0-9:-]+$/)
    .refine((value) => value.replace(/[^a-zA-Z0-9]/g, '').length >= 6 && value.replace(/[^a-zA-Z0-9]/g, '').length <= 64),
  pin: z.string().regex(/^\d{4,12}$/),
  confirmationPin: z.string().regex(/^\d{4,12}$/),
  idempotencyKey: z.string().uuid(),
}).strict().refine((value) => value.pin === value.confirmationPin, { message: 'PIN entries do not match', path: ['confirmationPin'] })
export type EnrollmentInput = z.infer<typeof EnrollmentSchema>

export const ManagedStudentSchema = z.object({
  student_id: z.string().uuid(),
  student_code: z.string(),
  display_name: z.string(),
  active: z.boolean(),
  balance_won: z.number().int(),
  card_active: z.boolean(),
  pin_locked_until: z.string().nullable(),
  created_at: z.string(),
  audit_reference: z.string().nullable(),
  year_group: z.number().int().min(1).max(13).nullable().optional(),
  academic_year: z.string().nullable().optional(),
  pin_set: z.boolean().optional(),
  total_count: z.number().int().nonnegative().optional(),
})
export type ManagedStudent = z.infer<typeof ManagedStudentSchema>

export const RosterStudentSchema = ManagedStudentSchema.extend({
  year_group: z.number().int().min(1).max(13).nullable(),
  academic_year: z.string().nullable(),
  pin_set: z.boolean(),
  total_count: z.number().int().nonnegative(),
})
export const RosterQuerySchema = z.object({
  query: z.string().trim().max(120),
  yearGroup: z.number().int().min(1).max(13).nullable(),
  offset: z.number().int().min(0).max(1000000),
}).strict()

export const EnrollmentResultSchema = z.object({
  student_id: z.string().uuid(),
  student_code: z.string(),
  display_name: z.string(),
  balance_won: z.literal(0),
  card_active: z.literal(true),
  created_at: z.string(),
  audit_reference: z.string(),
})
export type EnrollmentResult = z.infer<typeof EnrollmentResultSchema>

export const EnrollmentDecisionSchema = z.object({
  outcome: z.enum(['ENROLLED', 'STUDENT_EXISTS', 'CARD_ASSIGNED', 'IDEMPOTENCY_CONFLICT', 'RATE_LIMITED']),
  student_id: z.string().uuid().nullable(),
  student_code: z.string().nullable(),
  display_name: z.string().nullable(),
  balance_won: z.number().int().nullable(),
  card_active: z.boolean().nullable(),
  created_at: z.string().nullable(),
  audit_reference: z.string().nullable(),
})
