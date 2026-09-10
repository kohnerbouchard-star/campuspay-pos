const CUSTOMER_DESTINATIONS = new Set(['/store', '/store/orders', '/store/account'])

/** Keep post-login navigation on a known customer page, including safe anchors. */
export function safeCustomerDestination(value: unknown): string {
  if (typeof value !== 'string' || /[\\\u0000-\u001f\u007f]/.test(value)) return '/store'
  try {
    const url = new URL(value, 'https://mica.invalid')
    if (!value.startsWith('/') || url.origin !== 'https://mica.invalid' || !CUSTOMER_DESTINATIONS.has(url.pathname)) return '/store'
    return `${url.pathname}${url.hash === '#cart' ? '#cart' : ''}`
  } catch { return '/store' }
}

export function customerLoginPath(destination: string, expired = false): string {
  const params = new URLSearchParams({ next: safeCustomerDestination(destination) })
  if (expired) params.set('reason', 'expired')
  return `/store/login?${params}`
}
