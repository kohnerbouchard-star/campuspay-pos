import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

export async function proxy(request: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY

  // Connection is intentionally optional until the owner supplies credentials.
  // This permits the source and landing page to exist without contacting Supabase.
  if (!url || !publishableKey) {
    const response = NextResponse.next({ request })
    response.headers.set('Cache-Control', 'private, no-store, max-age=0')
    response.headers.set('X-CampusPay-Connection', 'unconfigured')
    return response
  }

  let response = NextResponse.next({ request })
  const supabase = createServerClient(url, publishableKey, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(items) {
        for (const { name, value } of items) request.cookies.set(name, value)
        response = NextResponse.next({ request })
        for (const { name, value, options } of items) response.cookies.set(name, value, options)
      },
    },
  })
  await supabase.auth.getClaims()
  response.headers.set('Cache-Control', 'private, no-store, max-age=0')
  return response
}

export const config = { matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'] }
