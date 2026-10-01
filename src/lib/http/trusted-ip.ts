import { createHmac, timingSafeEqual } from 'node:crypto'
import { isIP } from 'node:net'

/** Only Vercel's overwritten platform header is authoritative on Vercel.
 * Self-hosted requests share a fallback bucket until a trusted ingress is configured.
 * A caller-supplied X-Forwarded-For/X-Real-IP never chooses a new rate-limit bucket.
 */
export function trustedClientIp(headers: Headers, vercel = process.env.VERCEL === '1'): string {
  const ip = vercel ? headers.get('x-vercel-forwarded-for')?.trim() : null
  return ip && isIP(ip) ? ip.toLowerCase() : 'unverified-ingress'
}

/** A self-hosted ingress must overwrite all three headers and keep this key private.
 * The signature binds the client IP to this exact method/path for at most 30 seconds.
 */
export function signedIngressIp(request: Request, secret: string | undefined, now = Date.now()): string | null {
  if (!secret || secret.length < 32) return null
  const ip = request.headers.get('x-campuspay-client-ip') ?? ''
  const timestamp = request.headers.get('x-campuspay-ingress-time') ?? ''
  const signature = request.headers.get('x-campuspay-ingress-signature') ?? ''
  if (!isIP(ip) || !/^\d{10}$/.test(timestamp) || !/^[a-f0-9]{64}$/.test(signature)) return null
  if (Math.abs(now - Number(timestamp) * 1000) > 30_000) return null
  const message = `${timestamp}\n${request.method}\n${new URL(request.url).pathname}\n${ip}`
  const expected = createHmac('sha256', secret).update(message).digest()
  return timingSafeEqual(expected, Buffer.from(signature, 'hex')) ? ip.toLowerCase() : null
}
export function customerIngressBucket(request: Request, cardFingerprint: string, env: Record<string, string | undefined>): string {
  const platformIp = trustedClientIp(request.headers, env.VERCEL === '1')
  const ip = platformIp !== 'unverified-ingress' ? platformIp : signedIngressIp(request, env.CAMPUSPAY_INGRESS_SECRET)
  if (ip) return `customer-ip:${ip}`
  if (env.NODE_ENV === 'production' && env.CAMPUSPAY_LOCAL_HTTP !== 'true') throw new Error('DATABASE_NOT_CONFIGURED: trusted ingress unavailable')
  // Development/local HTTP lacks a trusted remote address. Separate credentials,
  // not caller-supplied forwarded headers, so one student cannot lock every student.
  return `customer-local-card:${cardFingerprint}`
}
