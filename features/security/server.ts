import 'server-only'
import { randomBytes } from 'node:crypto'
import { z } from 'zod'
import type { SessionContext } from '@/features/auth/domain'
import { createSecretSupabaseClient } from '@/lib/supabase/admin'
import { getServerEnv } from '@/lib/env/server'
import { hmacHex } from '@/lib/crypto/hmac'
import { fingerprintCard } from '@/lib/crypto/card-fingerprint'
import { studentPinProof } from '@/lib/crypto/student-pin'
import { callApiRpc } from '@/lib/supabase/rpc'
import { ApiError } from '@/lib/api/errors'
import { StepUpResultSchema, ResetResultSchema } from '@/features/security/domain'

function emailFor(code: string) { return `${code.toLowerCase()}@${getServerEnv().STAFF_AUTH_EMAIL_DOMAIN}` }
function fingerprintElevation(token: string) { return hmacHex(getServerEnv().SESSION_HMAC_SECRET, `elevation:${token}`) }

export async function createStepUp(
  session: SessionContext,
  input: { superAdminEmployeeCode: string; superAdminPin: string; purpose: string; studentId: string },
) {
  const isolated = createSecretSupabaseClient()
  const { data, error } = await isolated.auth.signInWithPassword({
    email: emailFor(input.superAdminEmployeeCode), password: input.superAdminPin,
  })
  if (error || !data.user) throw new ApiError(401, 'UNAUTHENTICATED', 'Super-administrator verification failed')

  const token = randomBytes(32).toString('base64url')
  const result = await callApiRpc('create_elevation', {
    p_session_id: session.session_id,
    p_approver_user_id: data.user.id,
    p_purpose: input.purpose,
    p_student_id: input.studentId,
    p_token_hash: fingerprintElevation(token),
  }, z.array(z.object({ expires_at: z.string() })).length(1).transform(([row]) => ({
    authorizationToken: token, expiresAt: row.expires_at,
  })))
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
