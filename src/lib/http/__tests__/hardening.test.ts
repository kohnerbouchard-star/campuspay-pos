import { describe, expect, it } from 'vitest'
import {
  configuredHttpsHost,
  contentSecurityPolicy,
  PERMISSIONS_POLICY,
  productionSurfaceConfiguration,
} from '../security-headers'
import { trustedClientIp } from '../trusted-ip'
import { businessDate, businessDateTimeInput, businessDateTimeToIso, formatBusinessTime } from '@/lib/format/business-time'

describe('production HTTP boundaries', () => {
  it('uses nonce scripts without production eval or script inline allowances', () => {
    const policy = contentSecurityPolicy('random-test-nonce', false, true)
    expect(policy).toContain("script-src 'self' 'nonce-random-test-nonce' 'strict-dynamic';")
    expect(policy).not.toContain('unsafe-eval')
    expect(policy).toContain("frame-ancestors 'none'")
    expect(PERMISSIONS_POLICY).toContain('camera=()')
    expect(contentSecurityPolicy('nonce', true, false)).toContain('unsafe-eval')
    expect(contentSecurityPolicy('nonce', true, false)).toContain("style-src 'self' 'unsafe-inline'")
    expect(contentSecurityPolicy('nonce', false, false)).toContain("style-src 'self' 'nonce-nonce'")
    expect(contentSecurityPolicy('nonce', false, false)).not.toContain('upgrade-insecure-requests')
  })
  it('requires two distinct exact HTTPS production origins', () => {
    expect(productionSurfaceConfiguration('https://pos.school.test', 'https://store.school.test', true)).toEqual({
      staffOrigin: 'https://pos.school.test',
      storeOrigin: 'https://store.school.test',
      staffHost: 'pos.school.test',
      storeHost: 'store.school.test',
    })
    expect(productionSurfaceConfiguration(undefined, 'https://store.school.test', true)).toBeNull()
    expect(productionSurfaceConfiguration('http://pos.school.test', 'https://store.school.test', true)).toBeNull()
    expect(productionSurfaceConfiguration('https://same.school.test', 'https://same.school.test', true)).toBeNull()
    expect(productionSurfaceConfiguration('https://pos.school.test/path', 'https://store.school.test', true)).toBeNull()
    expect(productionSurfaceConfiguration('https://pos.school.test', 'https://store.school.test', false)).toBeNull()
  })
  it('enables HSTS only on a configured production HTTPS host', () => {
    expect(configuredHttpsHost('staff.example', ['https://staff.example'], true)).toBe(true)
    expect(configuredHttpsHost('localhost:3000', ['http://localhost:3000'], true)).toBe(false)
    expect(configuredHttpsHost('attacker.example', ['https://staff.example'], true)).toBe(false)
    expect(configuredHttpsHost('staff.example', ['https://staff.example'], false)).toBe(false)
  })
  it('fails closed for unverified self-hosted production ingress', () => {
    const headers = new Headers({
      'x-forwarded-for': '1.2.3.4',
      'x-real-ip': '2.3.4.5',
      'x-vercel-forwarded-for': '3.4.5.6',
    })
    expect(trustedClientIp(headers, false, undefined, true)).toBeNull()
    expect(trustedClientIp(new Headers({ 'x-campuspay-client-ip': '4.5.6.7' }), false, 'x-campuspay-client-ip', true)).toBe('4.5.6.7')
    expect(trustedClientIp(new Headers({ 'x-campuspay-client-ip': '4.5.6.7, 8.9.10.11' }), false, 'x-campuspay-client-ip', true)).toBeNull()
    expect(trustedClientIp(headers, false, undefined, false)).toBe('development-ingress')
  })
  it('uses only the Vercel platform IP and rejects ambiguous/malformed chains', () => {
    expect(trustedClientIp(new Headers({ 'x-forwarded-for': '1.2.3.4', 'x-real-ip': '2.3.4.5', 'x-vercel-forwarded-for': '3.4.5.6' }), true, undefined, true)).toBe('3.4.5.6')
    for (const ip of ['1.2.3.4, 2.3.4.5', 'unknown', '999.2.3.4', '']) {
      expect(trustedClientIp(new Headers({ 'x-vercel-forwarded-for': ip }), true, undefined, true)).toBeNull()
    }
    expect(trustedClientIp(new Headers({ 'x-vercel-forwarded-for': '2001:db8::1' }), true, undefined, true)).toBe('2001:db8::1')
  })
})
describe('school business dates', () => {
  it('uses Korea time for date-time inputs independently of the device timezone', () => {
    expect(businessDateTimeInput(new Date('2026-09-08T15:00:00Z'))).toBe('2026-09-09T00:00')
    expect(businessDateTimeToIso('2026-09-09T00:00')).toBe('2026-09-08T15:00:00.000Z')
    expect(() => businessDateTimeToIso('not-a-date')).toThrow()
  })
  it.each([['2026-09-08T14:59:59Z', '2026-09-08'], ['2026-09-08T15:00:00Z', '2026-09-09']])('aligns %s with %s', (instant, day) => {
    expect(businessDate(new Date(instant))).toBe(day)
    expect(formatBusinessTime(instant)).toContain(day.endsWith('09') ? '9 Sept 2026' : '8 Sept 2026')
  })
})
