import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { proxy } from '@/proxy'
afterEach(() => vi.unstubAllEnvs())
beforeEach(() => {
  vi.stubEnv('NODE_ENV', 'production'); vi.stubEnv('VERCEL', '1')
  vi.stubEnv('CAMPUSPAY_LOCAL_HTTP', 'false'); vi.stubEnv('COOKIE_SECURE', 'true')
  vi.stubEnv('DATABASE_URL_UNPOOLED', '')
  vi.stubEnv('STAFF_ORIGIN', 'https://pos.school.test'); vi.stubEnv('STORE_ORIGIN', 'https://store.school.test')
})
describe('actual Next.js proxy enforcement', () => {
  it('rejects an unapproved deployment alias before authentication or redirects', () => {
    const response = proxy(new NextRequest('https://unapproved.vercel.app/login'))
    expect(response.status).toBe(403); expect(response.headers.get('location')).toBeNull()
    expect(response.headers.get('cache-control')).toContain('no-store')
  })
  it('fails closed with missing public origins or insecure cookies', () => {
    vi.stubEnv('STORE_ORIGIN', '')
    expect(proxy(new NextRequest('https://pos.school.test/login')).status).toBe(503)
    vi.stubEnv('STORE_ORIGIN', 'https://store.school.test'); vi.stubEnv('COOKIE_SECURE', 'false')
    expect(proxy(new NextRequest('https://pos.school.test/login')).status).toBe(503)
  })
  it('keeps dedicated host API isolation and production headers', () => {
    expect(proxy(new NextRequest('https://store.school.test/api/auth/login')).status).toBe(403)
    expect(proxy(new NextRequest('https://pos.school.test/api/store/login')).status).toBe(403)
    const response = proxy(new NextRequest('https://pos.school.test/login'))
    expect(response.status).toBe(200)
    expect(response.headers.get('strict-transport-security')).toBe('max-age=31536000')
    expect(response.headers.get('content-security-policy')).not.toContain('unsafe-eval')
    expect(response.headers.get('x-request-id')).toBeTruthy()
  })
  it('accepts only the explicit loopback host in local production-build mode', () => {
    vi.stubEnv('VERCEL', '0'); vi.stubEnv('CAMPUSPAY_LOCAL_HTTP', 'true')
    vi.stubEnv('STAFF_ORIGIN', ''); vi.stubEnv('STORE_ORIGIN', '')
    vi.stubEnv('APP_ORIGIN', 'http://127.0.0.1:3100'); vi.stubEnv('COOKIE_SECURE', 'false')
    expect(proxy(new NextRequest('http://127.0.0.1:3100/login', { headers: { host: '127.0.0.1:3100' } })).status).toBe(200)
    expect(proxy(new NextRequest('http://unapproved.test:3100/login')).status).toBe(403)
  })
})
