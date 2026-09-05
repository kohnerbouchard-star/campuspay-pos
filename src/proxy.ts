import { NextResponse, type NextRequest } from 'next/server'

export function proxy(request: NextRequest) {
  const response = NextResponse.next({ request })
  response.headers.set('Cache-Control', 'private, no-store, max-age=0')
  response.headers.set('X-Content-Type-Options', 'nosniff')
  response.headers.set('Referrer-Policy', 'same-origin')
  response.headers.set('X-Frame-Options', 'DENY')
  return response
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
