import type { Permission } from '@/features/auth/domain'

export type WorkspaceLink = Readonly<{
  label: string
  title: string
  href: string
  permission: Permission
}>

export const WORKSPACE_LINKS: readonly WorkspaceLink[] = [
  { label: 'Point of sale', title: 'Point of sale', href: '/pos', permission: 'pos.read' },
  { label: 'Online orders', title: 'Online orders', href: '/orders', permission: 'orders.fulfill' },
  { label: 'Inventory', title: 'Inventory', href: '/inventory', permission: 'inventory.read' },
  { label: 'Coupons', title: 'Coupons', href: '/coupons', permission: 'coupons.manage' },
  { label: 'Accounting', title: 'Accounting', href: '/accounting', permission: 'wallet.read' },
  { label: 'Security', title: 'Credential security', href: '/security', permission: 'security.credentials.request' },
]
