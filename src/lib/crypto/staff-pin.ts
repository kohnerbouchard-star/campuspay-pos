import 'server-only'
import { getServerEnv } from '@/lib/env/server'
import { hmacHex } from '@/lib/crypto/hmac'

export function staffPinProof(pin: string): string {
  if (!/^\d{4,16}$/.test(pin)) throw new Error('Invalid staff PIN format')
  return hmacHex(getServerEnv().STAFF_PIN_PEPPER, `staff-pin:${pin}`)
}
