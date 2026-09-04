import { describe, expect, it } from 'vitest'
import { ROLE_PERMISSIONS } from '@/features/auth/permissions'

describe('least privilege role matrix', () => {
  it('gives a cashier only checkout-related permissions', () => {
    expect(ROLE_PERMISSIONS.cashier).toEqual(['pos.read', 'pos.checkout', 'coupons.redeem'])
  })

  it('prevents cashiers from managing coupon definitions', () => {
    expect(ROLE_PERMISSIONS.cashier).not.toContain('coupons.manage')
  })

  it('allows inventory administrators to manage coupons but not student wallets', () => {
    expect(ROLE_PERMISSIONS.inventory_admin).toContain('coupons.manage')
    expect(ROLE_PERMISSIONS.inventory_admin).not.toContain('wallet.adjust')
  })

  it('lets accountants report on coupons without creating them', () => {
    expect(ROLE_PERMISSIONS.accountant).toContain('reports.coupons')
    expect(ROLE_PERMISSIONS.accountant).not.toContain('coupons.manage')
  })

  it('prevents accountants from receiving stock', () => {
    expect(ROLE_PERMISSIONS.accountant).not.toContain('inventory.receive')
  })
})
