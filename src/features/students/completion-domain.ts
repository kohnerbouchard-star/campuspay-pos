import { z } from 'zod'

export const CompleteEnrollmentSchema = z.object({
  expectedCode: z.string().min(1).max(40).regex(/^[A-Za-z0-9_-]+$/),
  expectedName: z.string().min(1).max(120).refine(value => !/[\u0000-\u001f\u007f]/.test(value)),
  expectedYear: z.number().int().min(1).max(13).nullable(),
  expectedAcademicYear: z.string().regex(/^\d{4}-\d{4}$/).nullable(),
  identityVerified: z.literal(true),
  cardRead: z.string().min(6).max(128).regex(/^[A-Za-z0-9:-]+$/)
    .refine(value => { const length = value.replace(/[^a-zA-Z0-9]/g, '').length; return length >= 6 && length <= 64 }),
  pin: z.string().regex(/^\d{4,12}$/),
  confirmationPin: z.string().regex(/^\d{4,12}$/),
  idempotencyKey: z.string().uuid(),
}).strict().refine(value => value.pin === value.confirmationPin, { message: 'PIN entries do not match', path: ['confirmationPin'] })
export type CompleteEnrollmentInput = z.infer<typeof CompleteEnrollmentSchema>
export const RecoverCompletionSchema = z.object({ idempotencyKey: z.string().uuid() }).strict()
export const CompletionDecisionSchema = z.discriminatedUnion('outcome', [
  z.object({ outcome: z.literal('COMPLETED'), student_id: z.string().uuid(), audit_reference: z.string().min(1), completed_at: z.string() }),
  z.object({ outcome: z.enum(['CLOSED','IDEMPOTENCY_CONFLICT','RATE_LIMITED','NOT_FOUND','INACTIVE','STUDENT_CHANGED','ALREADY_ISSUED','CARD_ASSIGNED']), student_id: z.null(), audit_reference: z.null(), completed_at: z.null() }),
])
export type CompletionDecision = z.infer<typeof CompletionDecisionSchema>
export function completionEnabled(value: string | undefined): boolean { return value === 'true' }
export const COMPLETION_MESSAGES: Record<Exclude<CompletionDecision['outcome'], 'COMPLETED'>, string> = {
  CLOSED: 'This request is closed without completing enrollment. Verify the student again before starting a new request.',
  IDEMPOTENCY_CONFLICT: 'This request belongs to a different operator or enrollment. The original operator must resolve it before proceeding.',
  RATE_LIMITED: 'Too many enrollment attempts. Wait one minute, then verify the student again.',
  NOT_FOUND: 'This student could not be found. Return to the directory.',
  INACTIVE: 'This student account is inactive. No card or PIN was issued.',
  STUDENT_CHANGED: 'The student details changed. Return to the directory and verify the current name, Year and ID.',
  ALREADY_ISSUED: 'This account already has credential or enrollment history. Use the authorized replacement/reset workflow; do not create a duplicate student.',
  CARD_ASSIGNED: 'That card has already been assigned. No changes were made by this attempt. Use a different, unused card.',
}
