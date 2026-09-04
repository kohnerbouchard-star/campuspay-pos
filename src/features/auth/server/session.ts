import 'server-only'
import { z } from 'zod'
import { ApiError } from '@/lib/api/errors'
import { readAppCookies } from '@/lib/http/cookies'
import { fingerprintSessionToken, fingerprintTerminalToken } from '@/lib/crypto/session-fingerprint'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { SessionContextSchema, type Permission, type SessionContext } from '@/features/auth/domain'

const RpcResult = z.array(SessionContextSchema).max(1)

async function authorize(permission: Permission | null): Promise<SessionContext> {
  const { sessionToken, terminalToken } = await readAppCookies()
  if (!sessionToken || !terminalToken) throw new ApiError(401, 'UNAUTHENTICATED', 'Sign-in required')

  const supabase = await createServerSupabaseClient()
  const { data: claimsData, error: claimsError } = await supabase.auth.getClaims()
  const userId = claimsData?.claims?.sub
  if (claimsError || !userId) throw new ApiError(401, 'UNAUTHENTICATED', 'Sign-in required')

  const { data, error } = await supabase.schema('api').rpc('authorize_session', {
    p_session_token_hash: fingerprintSessionToken(sessionToken),
    p_terminal_fingerprint: fingerprintTerminalToken(terminalToken),
    p_permission: permission,
  })
  if (error) {
    if (error.message.includes('SESSION_EXPIRED')) throw new ApiError(401, 'SESSION_EXPIRED', 'Session expired')
    if (error.message.includes('FORBIDDEN')) throw new ApiError(403, 'FORBIDDEN', 'Permission denied')
    throw new ApiError(401, 'UNAUTHENTICATED', 'Session invalid')
  }

  const rows = RpcResult.parse(data)
  const context = rows[0]
  if (!context || context.user_id !== userId) throw new ApiError(401, 'UNAUTHENTICATED', 'Session invalid')
  return context
}

export function authorizeRequest(permission: Permission): Promise<SessionContext> {
  return authorize(permission)
}

export function authorizeAnyRequest(): Promise<SessionContext> {
  return authorize(null)
}
