import 'server-only'
import { ApiError } from '@/lib/api/errors'
import { randomBytes } from 'node:crypto'
import { z } from 'zod'
import type { SessionContext } from '@/features/auth/domain'
import { getServerEnv } from '@/lib/env/server'
import { hmacHex } from '@/lib/crypto/hmac'
import { fingerprintCard } from '@/lib/crypto/card-fingerprint'
import { staffPinProof } from '@/lib/crypto/staff-pin'
import { studentPinProof } from '@/lib/crypto/student-pin'
import { callApiRpc } from '@/lib/db/rpc'
import { StepUpResultSchema, ResetResultSchema, SecurityStudentSchema } from '@/features/security/domain'

export function searchSecurityStudents(session: SessionContext, query: string) {
  return callApiRpc('search_security_students', { p_session_id: session.session_id, p_query: query }, z.array(SecurityStudentSchema))
}

function fingerprintElevation(token: string) {
  return hmacHex(getServerEnv().SESSION_HMAC_SECRET, `elevation:${token}`)
}

export async function createStepUp(
  session: SessionContext,
  input: { superAdminEmployeeCode: string; superAdminPin: string; purpose: string; studentId: string },
) {
  const token = randomBytes(32).toString('base64url')
  const result = await callApiRpc('create_elevation', {
    p_session_id: session.session_id,
    p_approver_employee_code: input.superAdminEmployeeCode,
    p_approver_pin_proof: staffPinProof(input.superAdminPin),
    p_purpose: input.purpose,
    p_student_id: input.studentId,
    p_token_hash: fingerprintElevation(token),
  }, z.array(z.object({ expires_at: z.string() })).max(1).transform(([row]) => {
    if (!row) throw new ApiError(401, 'INVALID_PIN', 'Super-admin authentication failed or is temporarily locked')
    return { authorizationToken: token, expiresAt: row.expires_at }
  }))
  return StepUpResultSchema.parse(result)
}

export function resetStudentPin(session: SessionContext, studentId: string, authorizationToken: string, newPin: string) {
  return callApiRpc('reset_student_pin', {
    p_session_id: session.session_id,
    p_student_id: studentId,
    p_elevation_token_hash: fingerprintElevation(authorizationToken),
    p_new_pin_proof: studentPinProof(newPin),
  }, z.array(ResetResultSchema).length(1).transform(([row]) => row))
}

export function resetStudentCard(session: SessionContext, studentId: string, authorizationToken: string, cardRead: string) {
  return callApiRpc('reset_student_card', {
    p_session_id: session.session_id,
    p_student_id: studentId,
    p_elevation_token_hash: fingerprintElevation(authorizationToken),
    p_new_card_fingerprint: fingerprintCard(cardRead),
  }, z.array(ResetResultSchema).length(1).transform(([row]) => row))
}
