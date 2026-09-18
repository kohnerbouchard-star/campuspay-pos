import type { Permission } from '@/features/auth/domain'

export type WorkspaceLink = Readonly<{
  label: string
  title: string
  href: string
  permission: Permission
  anyPermissions?: readonly Permission[]
}>

export const REPORT_PERMISSIONS: readonly Permission[] = ['reports.sales', 'reports.inventory', 'reports.wallets', 'reports.coupons']
export function canAccessWorkspace(permissions: readonly Permission[], link: WorkspaceLink): boolean {
  return (link.anyPermissions ?? [link.permission]).some(permission => permissions.includes(permission))
}

export const WORKSPACE_LINKS: readonly WorkspaceLink[] = [
  { label: 'Point of sale', title: 'Point of sale', href: '/pos', permission: 'pos.read' },
  { label: 'Online orders', title: 'Online orders', href: '/orders', permission: 'orders.fulfill' },
  { label: 'Students', title: 'Students', href: '/students', permission: 'students.manage' },
  { label: 'Inventory', title: 'Inventory', href: '/inventory', permission: 'inventory.read' },
  { label: 'Coupons', title: 'Coupons', href: '/coupons', permission: 'coupons.manage' },
  { label: 'Accounting', title: 'Accounting', href: '/accounting', permission: 'wallet.read' },
  { label: 'Refunds', title: 'Refunds', href: '/refunds', permission: 'reports.sales' },
  { label: 'Reports', title: 'Reports', href: '/reports', permission: 'reports.sales', anyPermissions: REPORT_PERMISSIONS },
  { label: 'Security', title: 'Credential security', href: '/security', permission: 'security.credentials.request' },
  { label: 'Payment settings', title: 'Payment settings', href: '/settings/payments', permission: 'security.staff.manage' },
]
