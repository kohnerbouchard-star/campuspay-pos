import { NextResponse, type NextRequest } from 'next/server'

function configuredHost(value: string | undefined): string | null {
  if (!value) return null
  try { return new URL(value).host.toLowerCase() } catch { return null }
}

function secureHeaders(response: NextResponse) {
  response.headers.set('Cache-Control', 'private, no-store, max-age=0')
  response.headers.set('X-Content-Type-Options', 'nosniff')
  response.headers.set('Referrer-Policy', 'same-origin')
  response.headers.set('X-Frame-Options', 'DENY')
  return response
}

export function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname
  const host = (request.headers.get('host') || '').toLowerCase()
  const storeHost = configuredHost(process.env.STORE_ORIGIN)
  const staffHost = configuredHost(process.env.STAFF_ORIGIN)

  if (storeHost && host === storeHost && !pathname.startsWith('/api/')) {
    if (['/pos', '/inventory', '/accounting', '/coupons', '/security'].some((path) => pathname === path || pathname.startsWith(`${path}/`))) {
      return secureHeaders(NextResponse.redirect(new URL('/', request.url)))
    }
    if (pathname === '/') return secureHeaders(NextResponse.rewrite(new URL('/store', request.url)))
    if (pathname === '/orders') return secureHeaders(NextResponse.rewrite(new URL('/store/orders', request.url)))
  }

  if (staffHost && host === staffHost && pathname.startsWith('/store')) {
    return secureHeaders(NextResponse.redirect(new URL('/', request.url)))
  }

  return secureHeaders(NextResponse.next({ request }))
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
