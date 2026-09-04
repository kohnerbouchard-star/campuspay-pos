import 'server-only'
import { getServerEnv } from '@/lib/env/server'
import { hmacHex } from '@/lib/crypto/hmac'

export function normalizeCouponCode(raw: string): string {
  const normalized = raw.trim().toUpperCase().replace(/[\s-]+/g, '')
  if (!/^[A-Z0-9]{4,32}$/.test(normalized)) {
    throw new Error('Coupon codes must contain 4–32 letters or numbers')
  }
  return normalized
}

export function fingerprintCouponCode(raw: string): string {
  return hmacHex(getServerEnv().COUPON_HMAC_SECRET, normalizeCouponCode(raw))
}

export function maskCouponCode(raw: string): string {
  const normalized = normalizeCouponCode(raw)
  return `••••${normalized.slice(-4)}`
}
