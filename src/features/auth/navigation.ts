import type { Permission } from './domain'

export const WORKSPACE_GROUPS = ['Workspaces'] as const
export type WorkspaceGroup = typeof WORKSPACE_GROUPS[number]
export type WorkspaceLink = Readonly<{
  label: string; title: string; href: string; permission: Permission
  anyPermissions?: readonly Permission[]; group: WorkspaceGroup; description: string; routes?: readonly string[]
}>
export const REPORT_PERMISSIONS: readonly Permission[] = ['reports.sales', 'reports.inventory', 'reports.wallets', 'reports.coupons']
export const REGISTER_PERMISSIONS: readonly Permission[] = ['pos.read', 'orders.read', 'cash.read', 'cash.movement.record']
export const FINANCE_PERMISSIONS: readonly Permission[] = [...REPORT_PERMISSIONS, 'refunds.read', 'reconciliation.read', 'cash.history.all']
export const ADMIN_PERMISSIONS: readonly Permission[] = ['staff.read', 'terminals.read', 'settings.payments.manage']
export const WORKSPACE_LINKS: readonly WorkspaceLink[] = [
  { label: 'Register', title: 'Register', href: '/register', permission: 'pos.read', anyPermissions: REGISTER_PERMISSIONS, group: 'Workspaces', description: 'Take payments, fulfill orders and operate your drawer.', routes: ['/pos', '/orders', '/cash'] },
  { label: 'Students', title: 'Students', href: '/students', permission: 'students.read', group: 'Workspaces', description: 'Find a student, add funds and review their account.', routes: ['/students', '/security', '/accounting', '/funding'] },
  { label: 'Inventory', title: 'Inventory', href: '/inventory', permission: 'inventory.read', anyPermissions: ['inventory.read', 'coupons.read'], group: 'Workspaces', description: 'Work with products, receiving, stock and coupons.', routes: ['/inventory', '/coupons'] },
  { label: 'Finance', title: 'Finance', href: '/finance', permission: 'reports.sales', anyPermissions: FINANCE_PERMISSIONS, group: 'Workspaces', description: 'Review refunds, reconciliation and financial reports.', routes: ['/finance', '/refunds', '/reconciliation', '/reports', '/cash/history'] },
  { label: 'Admin', title: 'Admin', href: '/admin', permission: 'staff.read', anyPermissions: ADMIN_PERMISSIONS, group: 'Workspaces', description: 'Manage staff, exact access, registers and payment settings.', routes: ['/admin', '/administration', '/settings'] },
]
export const STAFF_SECTIONS = [
  { workspace: 'Register', label: 'POS', href: '/pos', anyPermissions: ['pos.read'] },
  { workspace: 'Register', label: 'Orders', href: '/orders', anyPermissions: ['orders.read'] },
  { workspace: 'Register', label: 'Register', href: '/cash', anyPermissions: ['cash.read'] },
  { workspace: 'Register', label: 'Cash movements', href: '/cash/movements', anyPermissions: ['cash.movement.record'] },
  { workspace: 'Students', label: 'Students', href: '/students', anyPermissions: ['students.read'] },
  { workspace: 'Students', label: 'Funding history & corrections', href: '/funding', anyPermissions: ['wallet.read'] },
  { workspace: 'Inventory', label: 'Products', href: '/inventory', anyPermissions: ['inventory.read'] },
  { workspace: 'Inventory', label: 'Coupons', href: '/coupons', anyPermissions: ['coupons.read'] },
  { workspace: 'Finance', label: 'Refunds', href: '/refunds', anyPermissions: ['refunds.read'] },
  { workspace: 'Finance', label: 'Reconciliation', href: '/reconciliation', anyPermissions: ['reconciliation.read'] },
  { workspace: 'Finance', label: 'Reports', href: '/reports', anyPermissions: REPORT_PERMISSIONS },
  { workspace: 'Finance', label: 'Cash history', href: '/cash/history', anyPermissions: ['cash.history.all'] },
  { workspace: 'Admin', label: 'Staff & registers', href: '/administration', anyPermissions: ['staff.read', 'terminals.read'] },
  { workspace: 'Admin', label: 'Payment settings', href: '/settings/payments', anyPermissions: ['settings.payments.manage'] },
] as const
export function canAccessWorkspace(permissions: readonly Permission[], link: WorkspaceLink): boolean {
  return (link.anyPermissions ?? [link.permission]).some(permission => permissions.includes(permission))
}
export function visibleSections(permissions: readonly Permission[], workspace: string) {
  return STAFF_SECTIONS.filter(s => s.workspace === workspace && s.anyPermissions.some(p => permissions.includes(p)))
}
export function activeWorkspace(pathname: string, links: readonly WorkspaceLink[]): WorkspaceLink | undefined {
  const path = pathname.replace(/\/+$/, '') || '/'
  return [...links].sort((a, b) => Math.max(...(b.routes ?? [b.href]).map(r => r.length)) - Math.max(...(a.routes ?? [a.href]).map(r => r.length)))
    .find(link => [link.href, ...(link.routes ?? [])].some(r => path === r || path.startsWith(`${r}/`)))
}
export function workspaceGroups(links: readonly WorkspaceLink[]) {
  return WORKSPACE_GROUPS.map(label => ({ label, links: links.filter(link => link.group === label) })).filter(group => group.links.length > 0)
}
export function defaultEffectiveWorkspace(permissions: readonly Permission[]): string {
  if (permissions.includes('pos.read')) return '/pos'
  if (permissions.includes('students.read')) return '/students'
  return STAFF_SECTIONS.find(s => s.anyPermissions.some(p => permissions.includes(p)))?.href ?? '/access-unavailable'
}
