import { isIP } from 'node:net'

function singleIp(value: string | null | undefined): string | null {
  const ip = value?.trim()
  return ip && isIP(ip) ? ip.toLowerCase() : null
}

/**
 * Vercel's overwritten platform header is authoritative when VERCEL=1.
 * Self-hosted production must explicitly name one header that a trusted ingress
 * overwrites with a single client IP. Without that contract, login rate limiting
 * fails closed instead of placing every student into one shared bucket.
 */
export function trustedClientIp(
  headers: Headers,
  vercel = process.env.VERCEL === '1',
  trustedIngressHeader = process.env.TRUSTED_CLIENT_IP_HEADER,
  production = process.env.NODE_ENV === 'production',
): string | null {
  if (vercel) return singleIp(headers.get('x-vercel-forwarded-for'))
  if (!production) return 'development-ingress'

  const headerName = trustedIngressHeader?.trim().toLowerCase()
  if (!headerName || !/^x-[a-z0-9-]{1,60}$/.test(headerName)) return null
  return singleIp(headers.get(headerName))
}
