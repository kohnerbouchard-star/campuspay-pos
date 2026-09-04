import type { Permission, StaffRole } from '@/features/auth/domain'

export const ROLE_PERMISSIONS: Readonly<Record<StaffRole, readonly Permission[]>> = {
  cashier: ['pos.read', 'pos.checkout', 'coupons.redeem'],
  inventory_admin: [
    'coupons.manage',
    'inventory.read', 'inventory.receive', 'inventory.adjust',
    'inventory.product.manage', 'inventory.price.manage',
    'reports.inventory', 'security.credentials.request',
  ],
  accountant: [
    'wallet.read', 'wallet.adjust',
    'reports.sales', 'reports.inventory', 'reports.wallets', 'reports.coupons',
    'security.credentials.request',
  ],
  super_admin: [
    'pos.read', 'pos.checkout', 'coupons.redeem', 'coupons.manage',
    'inventory.read', 'inventory.receive', 'inventory.adjust',
    'inventory.product.manage', 'inventory.price.manage',
    'wallet.read', 'wallet.adjust',
    'reports.sales', 'reports.inventory', 'reports.wallets', 'reports.coupons',
    'security.credentials.request', 'security.step_up', 'security.credentials.reset', 'security.staff.manage',
  ],
}

export function defaultWorkspace(role: StaffRole): string {
  switch (role) {
    case 'cashier': return '/pos'
    case 'inventory_admin': return '/inventory'
    case 'accountant': return '/accounting'
    case 'super_admin': return '/security'
  }
}
