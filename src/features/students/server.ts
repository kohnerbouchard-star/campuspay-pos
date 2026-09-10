import 'server-only'
import { z } from 'zod'
import type { SessionContext } from '@/features/auth/domain'
import { EnrollmentDecisionSchema, EnrollmentResultSchema, ManagedStudentSchema, type EnrollmentInput } from '@/features/students/domain'
import { ApiError } from '@/lib/api/errors'
import { fingerprintCard } from '@/lib/crypto/card-fingerprint'
import { studentPinProof } from '@/lib/crypto/student-pin'
import { callApiRpc } from '@/lib/db/rpc'

function requireSuperAdmin(session: SessionContext) {
  if (session.role !== 'super_admin' || !session.permissions.includes('students.manage')) {
    throw new ApiError(403, 'FORBIDDEN', 'Only Super Admin can manage MICA Money students')
  }
}

export function searchStudents(session: SessionContext, query: string) {
  requireSuperAdmin(session)
  return callApiRpc('search_students', { p_session_id: session.session_id, p_query: query }, z.array(ManagedStudentSchema))
}

export async function enrollStudent(session: SessionContext, input: EnrollmentInput) {
  requireSuperAdmin(session)
  const decision = await callApiRpc('enroll_student', {
    p_session_id: session.session_id,
    p_student_code: input.studentCode,
    p_display_name: input.displayName,
    p_card_fingerprint: fingerprintCard(input.cardRead),
    p_pin_proof: studentPinProof(input.pin),
    p_idempotency_key: input.idempotencyKey,
  }, z.array(EnrollmentDecisionSchema).length(1).transform(([row]) => row))
  switch (decision.outcome) {
    case 'STUDENT_EXISTS': throw new ApiError(409, 'CONFLICT', 'A student with that ID is already enrolled. Search for their existing account.')
    case 'CARD_ASSIGNED': throw new ApiError(409, 'CONFLICT', 'That MICA Money Card is already assigned. Scan an unused card.')
    case 'IDEMPOTENCY_CONFLICT': throw new ApiError(409, 'CONFLICT', 'This enrollment request has already been used. Start a new enrollment.')
    case 'RATE_LIMITED': throw new ApiError(429, 'RATE_LIMITED', 'Too many enrollment attempts. Wait one minute and try again.')
    default: return EnrollmentResultSchema.parse(decision)
  }
}
