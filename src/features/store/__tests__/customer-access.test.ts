import { afterEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { proxy } from '@/proxy'
import { CustomerLoginSchema } from '@/features/store/domain'
import { customerLoginPath, safeCustomerDestination } from '@/features/store/navigation'
import { NEXT_ORDER_STATUS } from '@/features/store/fulfillment'

afterEach(() => vi.unstubAllEnvs())
describe('customer navigation and session boundaries', () => {
  it.each(['/pos', '//evil.example', 'https://evil.example/store', '/store/../pos', '/store\\evil', '/store/%2f%2fevil', '/store/login', '/store\n/orders'])('rejects unsafe return destination %s', (value) => {
    expect(safeCustomerDestination(value)).toBe('/store')
  })
  it('preserves approved customer destinations and strips unrelated query parameters', () => {
    expect(safeCustomerDestination('/store/orders')).toBe('/store/orders')
    expect(safeCustomerDestination('/store#cart')).toBe('/store#cart')
    expect(safeCustomerDestination('/store/account?next=https://evil.example')).toBe('/store/account')
    expect(customerLoginPath('/store/orders', true)).toBe('/store/login?next=%2Fstore%2Forders&reason=expired')
  })
  it('requires the customer cookie even when a staff cookie is present', () => {
    const response = proxy(new NextRequest('http://localhost/store/orders', { headers: { cookie: 'campuspay_session=staff-only' } }))
    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toContain('/store/login?next=%2Fstore%2Forders')
    expect(response.headers.get('cache-control')).toContain('no-store')
  })
  it('keeps customer login public without exposing protected store paths', () => {
    expect(proxy(new NextRequest('http://localhost/store/login')).status).toBe(200)
    expect(proxy(new NextRequest('http://localhost/store/account')).status).toBe(307)
  })
  it('blocks staff APIs on a dedicated customer host and customer APIs on the staff host', () => {
    vi.stubEnv('VERCEL', '1'); vi.stubEnv('COOKIE_SECURE', 'true')
    vi.stubEnv('STORE_ORIGIN', 'https://store.school.test')
    vi.stubEnv('STAFF_ORIGIN', 'https://pos.school.test')
    expect(proxy(new NextRequest('https://store.school.test/api/pos/catalog', { headers: { host: 'store.school.test' } })).status).toBe(403)
    expect(proxy(new NextRequest('https://pos.school.test/api/store/catalog', { headers: { host: 'pos.school.test' } })).status).toBe(403)
    expect(proxy(new NextRequest('https://store.school.test/students', { headers: { host: 'store.school.test' } })).headers.get('location')).toBe('https://store.school.test/store')
  })
  it('allows both surfaces on one explicitly configured local loopback origin', () => {
    vi.stubEnv('CAMPUSPAY_LOCAL_HTTP', 'true')
    vi.stubEnv('APP_ORIGIN', 'http://localhost:3000')
    expect(proxy(new NextRequest('http://localhost:3000/api/store/login', { headers: { host: 'localhost:3000' } })).status).toBe(200)
  })
  it('rejects malformed credentials before card normalization can throw an internal error', () => {
    expect(CustomerLoginSchema.safeParse({ cardNumber: '------', pin: '1234' }).success).toBe(false)
    expect(CustomerLoginSchema.safeParse({ cardNumber: 'AB-CD 12 34', pin: '1234' }).success).toBe(true)
  })
  it('exposes only the immediate next fulfillment transition', () => {
    expect(NEXT_ORDER_STATUS.PLACED?.status).toBe('PICKING')
    expect(NEXT_ORDER_STATUS.PICKING?.status).toBe('READY')
    expect(NEXT_ORDER_STATUS.READY?.status).toBe('OUT_FOR_DELIVERY')
    expect(NEXT_ORDER_STATUS.OUT_FOR_DELIVERY?.status).toBe('DELIVERED')
    expect(NEXT_ORDER_STATUS.DELIVERED).toBeUndefined()
    expect(NEXT_ORDER_STATUS.CANCELLED).toBeUndefined()
  })
})
