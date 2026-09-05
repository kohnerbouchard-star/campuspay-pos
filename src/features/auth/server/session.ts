import 'server-only'
import { z } from 'zod'
import { ApiError } from '@/lib/api/errors'
import { readAppCookies } from '@/lib/http/cookies'
import { fingerprintSessionToken, fingerprintTerminalToken } from '@/lib/crypto/session-fingerprint'
import { callApiRpc } from '@/lib/db/rpc'
import { SessionContextSchema, type Permission, type SessionContext } from '@/features/auth/domain'

const RpcResult = z.array(SessionContextSchema).max(1)

async function authorize(permission: Permission | null): Promise<SessionContext> {
  const { sessionToken, terminalToken } = await readAppCookies()
  if (!sessionToken || !terminalToken) throw new ApiError(401, 'UNAUTHENTICATED', 'Sign-in required')

  const rows = await callApiRpc('authorize_session', {
    p_session_token_hash: fingerprintSessionToken(sessionToken),
    p_terminal_fingerprint: fingerprintTerminalToken(terminalToken),
    p_permission: permission,
  }, RpcResult)
  const context = rows[0]
  if (!context) throw new ApiError(401, 'UNAUTHENTICATED', 'Session invalid')
  return context
}

export function authorizeRequest(permission: Permission): Promise<SessionContext> {
  return authorize(permission)
}

export function authorizeAnyRequest(): Promise<SessionContext> {
  return authorize(null)
}
