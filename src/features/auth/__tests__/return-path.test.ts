import { describe, expect, it } from 'vitest'
import { safeStaffReturn } from '@/features/auth/return-path'
describe('staff return destination', () => {
  it('returns to a permitted exact workspace', () => expect(safeStaffReturn('/orders', ['orders.read', 'orders.fulfill'], '/pos')).toBe('/orders'))
  it.each(['https://evil.test', '//evil.test', '/\\evil.test', '/store', '/security', '/pos?next=evil', '/pos\n'])('rejects external, malformed, or unpermitted destination %s', value => expect(safeStaffReturn(value, ['pos.read'], '/pos')).toBe('/pos'))
})
