import { NextResponse, type NextRequest } from 'next/server'
import { customerLoginPath } from '@/features/store/navigation'
import { configuredHttpsHost, contentSecurityPolicy, PERMISSIONS_POLICY } from '@/lib/http/security-headers'

function configuredHost(value: string | undefined): string | null {
  if (!value) return null
  try { return new URL(value).host.toLowerCase() } catch { return null }
}

function secureHeaders(response: NextResponse, csp: string, requestId: string, https: boolean) {
  response.headers.set('Cache-Control', 'private, no-store, max-age=0')
  response.headers.set('X-Content-Type-Options', 'nosniff')
  response.headers.set('Referrer-Policy', 'same-origin')
  response.headers.set('X-Frame-Options', 'DENY')
  response.headers.set('Content-Security-Policy', csp)
  response.headers.set('Permissions-Policy', PERMISSIONS_POLICY)
  response.headers.set('X-Request-ID', requestId)
  if (https) response.headers.set('Strict-Transport-Security', 'max-age=31536000')
  return response
}

export function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname
  const host = (request.headers.get('host') || '').toLowerCase()
  const requestId = crypto.randomUUID()
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64')
  const https = configuredHttpsHost(host, [process.env.STAFF_ORIGIN, process.env.STORE_ORIGIN, process.env.APP_ORIGIN], process.env.NODE_ENV === 'production')
  const csp = contentSecurityPolicy(nonce, process.env.NODE_ENV === 'development', https)
  const headers = new Headers(request.headers)
  headers.set('x-nonce', nonce)
  headers.set('x-request-id', requestId)
  headers.set('Content-Security-Policy', csp)
  const secure = (response: NextResponse) => secureHeaders(response, csp, requestId, https)
  const storeHost = configuredHost(process.env.STORE_ORIGIN)
  const staffHost = configuredHost(process.env.STAFF_ORIGIN)

  const dedicatedStore = Boolean(storeHost && storeHost !== staffHost && host === storeHost)
  const dedicatedStaff = Boolean(staffHost && staffHost !== storeHost && host === staffHost)
  const customerPath = dedicatedStore
    ? (({ '/': '/store', '/orders': '/store/orders', '/account': '/store/account' } as Record<string, string>)[pathname] ?? pathname)
    : pathname

  if (dedicatedStore) {
    if (pathname.startsWith('/api/') && !pathname.startsWith('/api/store/')) {
      return secure(NextResponse.json({ ok: false, error: { code: 'FORBIDDEN', message: 'Staff access is available on the staff site.' } }, { status: 403 }))
    }
    if (['/pos', '/inventory', '/accounting', '/coupons', '/security', '/students', '/reports', '/refunds', '/cash', '/administration', '/funding', '/settings'].some((path) => pathname === path || pathname.startsWith(`${path}/`))) {
      return secure(NextResponse.redirect(new URL('/store', request.url)))
    }
    if (pathname === '/login') return secure(NextResponse.redirect(new URL('/store/login', request.url)))
  }

  if (dedicatedStaff && pathname.startsWith('/api/store/')) {
    return secure(NextResponse.json({ ok: false, error: { code: 'FORBIDDEN', message: 'MICA Money is available on the student store site.' } }, { status: 403 }))
  }
  if (dedicatedStaff && (pathname === '/store' || pathname.startsWith('/store/'))) {
    return secure(NextResponse.redirect(new URL('/', request.url)))
  }

  if ((customerPath === '/store' || customerPath.startsWith('/store/')) && customerPath !== '/store/login'
    && !request.cookies.get('campuspay_customer_session')?.value) {
    return secure(NextResponse.redirect(new URL(customerLoginPath(customerPath), request.url)))
  }

  if (dedicatedStore && customerPath !== pathname) {
    return secure(NextResponse.rewrite(new URL(customerPath, request.url), { request: { headers } }))
  }

  return secure(NextResponse.next({ request: { headers } }))
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
