export type ProductionSurfaceConfiguration = {
  staffOrigin: string
  storeOrigin: string
  staffHost: string
  storeHost: string
}

export function normalizedHttpsOrigin(value: string | undefined): string | null {
  if (!value) return null
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) return null
    return url.origin
  } catch {
    return null
  }
}

export function productionSurfaceConfiguration(
  staffOrigin: string | undefined,
  storeOrigin: string | undefined,
  production: boolean,
): ProductionSurfaceConfiguration | null {
  if (!production) return null
  const staff = normalizedHttpsOrigin(staffOrigin)
  const store = normalizedHttpsOrigin(storeOrigin)
  if (!staff || !store || staff === store) return null
  return {
    staffOrigin: staff,
    storeOrigin: store,
    staffHost: new URL(staff).host.toLowerCase(),
    storeHost: new URL(store).host.toLowerCase(),
  }
}

export function contentSecurityPolicy(nonce: string, development: boolean, https: boolean) {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${development ? " 'unsafe-eval'" : ''}`,
    development ? "style-src 'self' 'unsafe-inline'" : `style-src 'self' 'nonce-${nonce}'`,
    // React uses style attributes for progress widths and dialog geometry.
    // Script attributes remain blocked; stylesheet elements require a nonce.
    "style-src-attr 'unsafe-inline'",
    "img-src 'self' blob: data:", "font-src 'self'", "object-src 'none'",
    "base-uri 'self'", "form-action 'self'", "frame-ancestors 'none'",
    `connect-src 'self'${development ? ' ws: wss:' : ''}`,
    ...(https ? ['upgrade-insecure-requests'] : []),
  ].join('; ')
}

export function configuredHttpsHost(host: string, origins: (string | undefined)[], production: boolean) {
  return production && origins.some(value => {
    const origin = normalizedHttpsOrigin(value)
    return origin !== null && new URL(origin).host.toLowerCase() === host.toLowerCase()
  })
}

export const PERMISSIONS_POLICY = 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), serial=(), bluetooth=()'
