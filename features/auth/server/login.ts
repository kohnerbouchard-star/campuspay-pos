import 'server-only'
import { z } from 'zod'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { getServerEnv } from '@/lib/env/server'
import { ApiError } from '@/lib/api/errors'
import { ensureTerminalCookie, newOpaqueToken, setAppSessionCookie } from '@/lib/http/cookies'
import { fingerprintSessionToken, fingerprintTerminalToken } from '@/lib/crypto/session-fingerprint'
import { SessionContextSchema, type SessionContext } from '@/features/auth/domain'
import { defaultWorkspace } from '@/features/auth/permissions'

const CreatedSession = z.array(SessionContextSchema).length(1)

function staffEmail(employeeCode: string): string {
  return `${employeeCode.toLowerCase()}@${getServerEnv().STAFF_AUTH_EMAIL_DOMAIN}`
}

export async function loginStaff(employeeCode: string, pin: string): Promise<SessionContext & { workspace: string }> {
  const supabase = await createServerSupabaseClient()
  const { error } = await supabase.auth.signInWithPassword({ email: staffEmail(employeeCode), password: pin })
  if (error) throw new ApiError(401, 'UNAUTHENTICATED', 'Employee code or PIN is incorrect')

  const terminalToken = await ensureTerminalCookie()
  const sessionToken = newOpaqueToken()
  const { data, error: sessionError } = await supabase.schema('api').rpc('create_staff_session', {
    p_employee_code: employeeCode,
    p_session_token_hash: fingerprintSessionToken(sessionToken),
    p_terminal_fingerprint: fingerprintTerminalToken(terminalToken),
  })
  if (sessionError) {
    await supabase.auth.signOut()
    throw new ApiError(403, 'FORBIDDEN', sessionError.message)
  }

  const [context] = CreatedSession.parse(data)
  await setAppSessionCookie(sessionToken)
  return { ...context, workspace: defaultWorkspace(context.role) }
}
