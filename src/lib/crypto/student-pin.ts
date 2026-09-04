import 'server-only'
import { getServerEnv } from '@/lib/env/server'
import { hmacHex } from '@/lib/crypto/hmac'

export function studentPinProof(pin: string): string {
  if (!/^\d{4,12}$/.test(pin)) throw new Error('Invalid PIN format')
  return hmacHex(getServerEnv().STUDENT_PIN_PEPPER, `student-pin:${pin}`)
}
