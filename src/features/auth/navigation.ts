import type { Permission } from '@/features/auth/domain'

export const WORKSPACE_GROUPS = ['Daily work', 'Students & money', 'Reporting', 'Administration'] as const
export type WorkspaceGroup = typeof WORKSPACE_GROUPS[number]

export type WorkspaceLink = Readonly<{
  label: string
  title: string
  href: string
  permission: Permission
  anyPermissions?: readonly Permission[]
  group: WorkspaceGroup
  description: string
}>

export const REPORT_PERMISSIONS: readonly Permission[] = ['reports.sales', 'reports.inventory', 'reports.wallets', 'reports.coupons']
export function canAccessWorkspace(permissions: readonly Permission[], link: WorkspaceLink): boolean {
  return (link.anyPermissions ?? [link.permission]).some(permission => permissions.includes(permission))
}

export const WORKSPACE_LINKS: readonly WorkspaceLink[] = [
  { label: 'Point of sale', title: 'Point of sale', href: '/pos', permission: 'pos.read', group: 'Daily work', description: 'Build a sale and take payment.' },
  { label: 'Online orders', title: 'Online orders', href: '/orders', permission: 'orders.fulfill', group: 'Daily work', description: 'Pick, prepare and deliver student orders.' },
  { label: 'Students', title: 'Students', href: '/students', permission: 'students.manage', group: 'Students & money', description: 'Find an existing student or enroll a new account.' },
  { label: 'Inventory', title: 'Inventory', href: '/inventory', permission: 'inventory.read', group: 'Daily work', description: 'Manage products, stock receipts and stock levels.' },
  { label: 'Coupons', title: 'Coupons', href: '/coupons', permission: 'coupons.manage', group: 'Daily work', description: 'Create and manage purchase discounts.' },
  { label: 'Wallets & accounting', title: 'Accounting', href: '/accounting', permission: 'wallet.read', group: 'Students & money', description: 'Review wallet balances, adjustments and sales.' },
  { label: 'Wallet funding', title: 'Funding and cash', href: '/funding', permission: 'wallet.adjust', anyPermissions: ['wallet.adjust','pos.checkout'], group: 'Students & money', description: 'Record deposits, approved credits and deductions.' },
  { label: 'Cash drawer', title: 'Cash register', href: '/cash', permission: 'pos.checkout', anyPermissions: ['pos.checkout','reports.sales'], group: 'Students & money', description: 'Open, count and close this register’s cash drawer.' },
  { label: 'Refunds & returns', title: 'Refunds', href: '/refunds', permission: 'reports.sales', group: 'Students & money', description: 'Find a receipt to review refunds and returns.' },
  { label: 'Daily reconciliation', title: 'Daily reconciliation', href: '/reconciliation', permission: 'reports.sales', group: 'Reporting', description: 'Compare journals and investigate discrepancies.' },
  { label: 'Reports', title: 'Reports', href: '/reports', permission: 'reports.sales', anyPermissions: REPORT_PERMISSIONS, group: 'Reporting', description: 'Review sales, inventory, wallets and coupons.' },
  { label: 'PIN & card access', title: 'Credential security', href: '/security', permission: 'security.credentials.request', group: 'Administration', description: 'Request approval to reset a PIN or replace a card.' },
  { label: 'Staff & registers', title: 'Staff and terminals', href: '/administration', permission: 'security.staff.manage', group: 'Administration', description: 'Manage staff access and registered terminals.' },
  { label: 'Payment settings', title: 'Payment settings', href: '/settings/payments', permission: 'security.staff.manage', group: 'Administration', description: 'Manage cash and event payments for this register.' },
]

/** Match a route boundary, not a title or an arbitrary string prefix. */
export function activeWorkspace(pathname: string, links: readonly WorkspaceLink[]): WorkspaceLink | undefined {
  const path = pathname.replace(/\/+$/, '') || '/'
  return [...links].sort((a, b) => b.href.length - a.href.length)
    .find(link => path === link.href || path.startsWith(`${link.href}/`))
}

export function workspaceGroups(links: readonly WorkspaceLink[]) {
  return WORKSPACE_GROUPS.map(label => ({ label, links: links.filter(link => link.group === label) }))
    .filter(group => group.links.length > 0)
}
