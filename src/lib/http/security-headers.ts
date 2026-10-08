import { configuredPhotoOrigin } from '@/features/product-photos/config'

export function contentSecurityPolicy(nonce: string, development: boolean, https: boolean) {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${development ? " 'unsafe-eval'" : ''}`,
    development ? "style-src 'self' 'unsafe-inline'" : `style-src 'self' 'nonce-${nonce}'`,
    // React uses style attributes for progress widths and dialog geometry.
    // Script attributes remain blocked; stylesheet elements require a nonce.
    "style-src-attr 'unsafe-inline'",
    `img-src 'self' blob: data:${configuredPhotoOrigin() ? ` ${configuredPhotoOrigin()}` : ''}`, "font-src 'self'", "object-src 'none'",
    "base-uri 'self'", "form-action 'self'", "frame-ancestors 'none'",
    `connect-src 'self'${development ? ' ws: wss:' : ''}`,
    ...(https ? ['upgrade-insecure-requests'] : []),
  ].join('; ')
}

export function configuredHttpsHost(host: string, origins: (string | undefined)[], production: boolean) {
  return production && origins.some(value => {
    try { const url = new URL(value ?? ''); return url.protocol === 'https:' && url.host.toLowerCase() === host.toLowerCase() }
    catch { return false }
  })
}

export const PERMISSIONS_POLICY = 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), serial=(), bluetooth=()'
