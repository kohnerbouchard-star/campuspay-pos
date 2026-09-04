import 'server-only'
import { getServerEnv } from '@/lib/env/server'
import { hmacHex } from '@/lib/crypto/hmac'

export function fingerprintSessionToken(raw: string): string {
  return hmacHex(getServerEnv().SESSION_HMAC_SECRET, raw)
}

export function fingerprintTerminalToken(raw: string): string {
  return hmacHex(getServerEnv().TERMINAL_COOKIE_SECRET, raw)
}
