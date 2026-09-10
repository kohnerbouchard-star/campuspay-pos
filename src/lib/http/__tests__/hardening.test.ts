import { describe, expect, it } from 'vitest'
import { configuredHttpsHost, contentSecurityPolicy, PERMISSIONS_POLICY } from '../security-headers'
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
  it('enables HSTS only on a configured production HTTPS host', () => {
    expect(configuredHttpsHost('staff.example', ['https://staff.example'], true)).toBe(true)
    expect(configuredHttpsHost('localhost:3000', ['http://localhost:3000'], true)).toBe(false)
    expect(configuredHttpsHost('attacker.example', ['https://staff.example'], true)).toBe(false)
    expect(configuredHttpsHost('staff.example', ['https://staff.example'], false)).toBe(false)
  })
  it('ignores all forwarded IP claims outside the verified Vercel environment', () => {
    expect(trustedClientIp(new Headers({ 'x-forwarded-for': '1.2.3.4', 'x-real-ip': '2.3.4.5', 'x-vercel-forwarded-for': '3.4.5.6' }), false)).toBe('unverified-ingress')
  })
  it('uses only the Vercel platform IP and rejects ambiguous/malformed chains', () => {
    expect(trustedClientIp(new Headers({ 'x-forwarded-for': '1.2.3.4', 'x-real-ip': '2.3.4.5', 'x-vercel-forwarded-for': '3.4.5.6' }), true)).toBe('3.4.5.6')
    for (const ip of ['1.2.3.4, 2.3.4.5', 'unknown', '999.2.3.4', '']) expect(trustedClientIp(new Headers({ 'x-vercel-forwarded-for': ip }), true)).toBe('unverified-ingress')
    expect(trustedClientIp(new Headers({ 'x-vercel-forwarded-for': '2001:db8::1' }), true)).toBe('2001:db8::1')
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
