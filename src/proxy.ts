import { NextResponse, type NextRequest } from 'next/server'
import { customerLoginPath } from '@/features/store/navigation'

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

  const dedicatedStore = Boolean(storeHost && storeHost !== staffHost && host === storeHost)
  const dedicatedStaff = Boolean(staffHost && staffHost !== storeHost && host === staffHost)
  const customerPath = dedicatedStore
    ? (({ '/': '/store', '/orders': '/store/orders', '/account': '/store/account' } as Record<string, string>)[pathname] ?? pathname)
    : pathname

  if (dedicatedStore) {
    if (pathname.startsWith('/api/') && !pathname.startsWith('/api/store/')) {
      return secureHeaders(NextResponse.json({ ok: false, error: { code: 'FORBIDDEN', message: 'Staff access is available on the staff site.' } }, { status: 403 }))
    }
    if (['/pos', '/inventory', '/accounting', '/coupons', '/security', '/students', '/reports', '/settings'].some((path) => pathname === path || pathname.startsWith(`${path}/`))) {
      return secureHeaders(NextResponse.redirect(new URL('/store', request.url)))
    }
    if (pathname === '/login') return secureHeaders(NextResponse.redirect(new URL('/store/login', request.url)))
  }

  if (dedicatedStaff && pathname.startsWith('/api/store/')) {
    return secureHeaders(NextResponse.json({ ok: false, error: { code: 'FORBIDDEN', message: 'MICA Money is available on the student store site.' } }, { status: 403 }))
  }
  if (dedicatedStaff && (pathname === '/store' || pathname.startsWith('/store/'))) {
    return secureHeaders(NextResponse.redirect(new URL('/', request.url)))
  }

  if ((customerPath === '/store' || customerPath.startsWith('/store/')) && customerPath !== '/store/login'
    && !request.cookies.get('campuspay_customer_session')?.value) {
    return secureHeaders(NextResponse.redirect(new URL(customerLoginPath(customerPath), request.url)))
  }

  if (dedicatedStore && customerPath !== pathname) {
    return secureHeaders(NextResponse.rewrite(new URL(customerPath, request.url)))
  }

  return secureHeaders(NextResponse.next({ request }))
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
