import { isIP } from 'node:net'

/** Only Vercel's overwritten platform header is authoritative on Vercel.
 * Self-hosted requests share a fallback bucket until a trusted ingress is configured.
 * A caller-supplied X-Forwarded-For/X-Real-IP never chooses a new rate-limit bucket.
 */
export function trustedClientIp(headers: Headers, vercel = process.env.VERCEL === '1'): string {
  const ip = vercel ? headers.get('x-vercel-forwarded-for')?.trim() : null
  return ip && isIP(ip) ? ip.toLowerCase() : 'unverified-ingress'
}
