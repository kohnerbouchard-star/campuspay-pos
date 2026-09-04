import 'server-only'
import { getServerEnv } from '@/lib/env/server'
import { hmacHex } from '@/lib/crypto/hmac'

export function normalizeCardRead(raw: string): string {
  const normalized = raw.replace(/[^a-zA-Z0-9]/g, '').toUpperCase()
  if (normalized.length < 6 || normalized.length > 64) {
    throw new Error('Invalid card read')
  }
  return normalized
}

export function fingerprintCard(raw: string): string {
  return hmacHex(getServerEnv().CARD_HMAC_SECRET, normalizeCardRead(raw))
}
