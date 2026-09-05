import 'server-only'
import { clearAppCookies, readAppCookies } from '@/lib/http/cookies'
import { fingerprintSessionToken, fingerprintTerminalToken } from '@/lib/crypto/session-fingerprint'
import { callApiCommand } from '@/lib/db/rpc'

export async function logoutStaff(): Promise<void> {
  const { sessionToken, terminalToken } = await readAppCookies()
  if (sessionToken && terminalToken) {
    await callApiCommand('revoke_staff_session', {
      p_session_token_hash: fingerprintSessionToken(sessionToken),
      p_terminal_fingerprint: fingerprintTerminalToken(terminalToken),
    })
  }
  await clearAppCookies()
}
