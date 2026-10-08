import 'server-only'
import { z } from 'zod'
import type { SessionContext } from '@/features/auth/domain'
import { ApiError } from '@/lib/api/errors'
import { callApiRpc } from '@/lib/db/rpc'
import { fingerprintCard } from '@/lib/crypto/card-fingerprint'
import { studentPinProof } from '@/lib/crypto/student-pin'
import { CompleteEnrollmentSchema, CompletionDecisionSchema, completionEnabled, type CompleteEnrollmentInput } from './completion-domain'

export function isRosterIssuanceEnabled() { return completionEnabled(process.env.ROSTER_ISSUANCE_ENABLED) }
function requireIssuer(session: SessionContext) {
  if (!session.permissions.includes('students.enroll')) {
    throw new ApiError(403, 'FORBIDDEN', 'Authorized enrollment staff can complete student enrollment')
  }
}
const decision = z.array(CompletionDecisionSchema).length(1).transform(([row]) => row)

export function completeRosterEnrollment(session: SessionContext, studentId: string, input: CompleteEnrollmentInput) {
  requireIssuer(session)
  if (!isRosterIssuanceEnabled()) throw new ApiError(409, 'CONFLICT', 'Initial roster card issuance is disabled for this installation')
  const parsed = CompleteEnrollmentSchema.parse(input)
  return callApiRpc('complete_student_enrollment', {
    p_session_id: session.session_id, p_student_id: studentId,
    p_expected_code: parsed.expectedCode, p_expected_name: parsed.expectedName,
    p_expected_year: parsed.expectedYear, p_expected_academic_year: parsed.expectedAcademicYear,
    p_identity_verified: parsed.identityVerified,
    p_card_fingerprint: fingerprintCard(parsed.cardRead), p_pin_proof: studentPinProof(parsed.pin),
    p_idempotency_key: parsed.idempotencyKey,
  }, decision)
}

export function recoverRosterCompletion(session: SessionContext, studentId: string, requestId: string) {
  requireIssuer(session)
  // Recovery must remain available when new issuance is disabled during an incident.
  return callApiRpc('recover_student_completion', {
    p_session_id: session.session_id, p_student_id: studentId, p_idempotency_key: requestId,
  }, decision)
}
