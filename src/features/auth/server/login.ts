import 'server-only'
import { z } from 'zod'
import { ApiError } from '@/lib/api/errors'
import { ensureTerminalCookie, newOpaqueToken, setAppSessionCookie } from '@/lib/http/cookies'
import { fingerprintSessionToken, fingerprintTerminalToken } from '@/lib/crypto/session-fingerprint'
import { staffPinProof } from '@/lib/crypto/staff-pin'
import { callApiRpc } from '@/lib/db/rpc'
import { SessionContextSchema, type SessionContext } from '@/features/auth/domain'
import { defaultWorkspace } from '@/features/auth/permissions'

const CreatedSession = z.array(SessionContextSchema).max(1)

export async function loginStaff(employeeCode: string, pin: string): Promise<SessionContext & { workspace: string }> {
  const terminalToken = await ensureTerminalCookie()
  const sessionToken = newOpaqueToken()

  try {
    const [context] = await callApiRpc('create_staff_session', {
      p_employee_code: employeeCode,
      p_pin_proof: staffPinProof(pin),
      p_session_token_hash: fingerprintSessionToken(sessionToken),
      p_terminal_fingerprint: fingerprintTerminalToken(terminalToken),
    }, CreatedSession)
    if (!context) throw new ApiError(401, 'UNAUTHENTICATED', 'Employee code or PIN is incorrect, or sign-in is temporarily locked')
    await setAppSessionCookie(sessionToken)
    return { ...context, workspace: defaultWorkspace(context.role) }
  } catch (error) {
    throw error
  }
}
