import 'server-only'
import { createHmac } from 'node:crypto'
import { z } from 'zod'
import { ApiError } from '@/lib/api/errors'
import { fingerprintCard } from '@/lib/crypto/card-fingerprint'
import { studentPinProof } from '@/lib/crypto/student-pin'
import { fingerprintCustomerSessionToken } from '@/lib/crypto/session-fingerprint'
import { getServerEnv } from '@/lib/env/server'
import {
  clearCustomerSessionCookie, newOpaqueToken, readCustomerSessionCookie, setCustomerSessionCookie,
} from '@/lib/http/cookies'
import { callApiCommand, callApiRpc } from '@/lib/db/rpc'
import { CustomerSessionSchema, type CustomerSession } from '@/features/store/domain'

const CustomerSessionRows = z.array(CustomerSessionSchema).max(1)

function requestIp(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
  return forwarded || request.headers.get('x-real-ip') || 'unknown'
}

function fingerprintIp(request: Request): string {
  return createHmac('sha256', getServerEnv().SESSION_HMAC_SECRET)
    .update(`customer-ip:${requestIp(request)}`)
    .digest('hex')
}

export async function loginCustomerSession(request: Request, cardNumber: string, pin: string): Promise<CustomerSession> {
  const rawToken = newOpaqueToken()
  const rows = await callApiRpc('create_customer_session', {
    p_card_fingerprint: fingerprintCard(cardNumber),
    p_pin_proof: studentPinProof(pin),
    p_session_token_hash: fingerprintCustomerSessionToken(rawToken),
    p_ip_fingerprint: fingerprintIp(request),
  }, CustomerSessionRows)
  const context = rows[0]
  if (!context) throw new ApiError(401, 'UNAUTHENTICATED', 'We couldn’t verify those MICA Money credentials. Check your card information and PIN and try again. Sign-in may be temporarily locked; wait a few minutes or visit E202 for help.')
  await setCustomerSessionCookie(rawToken)
  return context
}

export async function authorizeCustomerSession(): Promise<CustomerSession> {
  const token = await readCustomerSessionCookie()
  if (!token) throw new ApiError(401, 'UNAUTHENTICATED', 'Student sign-in required')
  const rows = await callApiRpc('authorize_customer_session', {
    p_session_token_hash: fingerprintCustomerSessionToken(token),
  }, CustomerSessionRows)
  const context = rows[0]
  if (!context) throw new ApiError(401, 'UNAUTHENTICATED', 'Student session is invalid')
  return context
}

export async function logoutCustomerSession() {
  const token = await readCustomerSessionCookie()
  if (token) {
    await callApiCommand('revoke_customer_session', {
      p_session_token_hash: fingerprintCustomerSessionToken(token),
    })
  }
  await clearCustomerSessionCookie()
}
