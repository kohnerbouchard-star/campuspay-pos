/** Metadata describes access; only the database can assign or authorize it. */
export const PRESETS = ['staff', 'manager', 'accountant', 'super_admin'] as const
export type AccessPreset = typeof PRESETS[number]
export const PRESET_LABELS: Record<AccessPreset, string> = { staff: 'Staff', manager: 'Manager', accountant: 'Accountant', super_admin: 'Super Admin' }
export const PRESET_DESCRIPTIONS: Record<AccessPreset, string> = {
  staff: 'Routine register operations. Assign other day-to-day functions individually.',
  manager: 'Broad store operations without staff access or system administration.',
  accountant: 'Student funding, financial reporting, reconciliation and independent cash review.',
  super_admin: 'Staff, access, terminal, security and system administration. Transaction safeguards still apply.',
}
export type Workspace = 'Register' | 'Students' | 'Inventory' | 'Finance' | 'Admin'
export type AccessColumn = 'View' | 'Operate' | 'Manage' | 'Approve'
const capability = <N extends string>(name: N, workspace: Workspace, area: string, column: AccessColumn, label: string, requires: readonly string[] = []) => ({ name, workspace, area, column, label, requires })
export const CAPABILITIES = [
  capability('pos.read', 'Register', 'Point of sale', 'View', 'View the register'),
  capability('pos.checkout', 'Register', 'Point of sale', 'Operate', 'Take payments', ['pos.read']),
  capability('coupons.redeem', 'Register', 'Sale coupons', 'Operate', 'Apply a sale coupon', ['pos.checkout']),
  capability('orders.read', 'Register', 'Online orders', 'View', 'View online orders'),
  capability('orders.fulfill', 'Register', 'Online orders', 'Operate', 'Fulfill online orders', ['orders.read']),
  capability('cash.read', 'Register', 'Cash drawer', 'View', 'View this register’s cash records'),
  capability('cash.shift.manage', 'Register', 'Cash drawer', 'Operate', 'Open and close an assigned drawer', ['cash.read']),
  capability('cash.drawer.override', 'Register', 'Cash drawer', 'Manage', 'Operate another employee’s drawer on this terminal', ['cash.shift.manage']),
  capability('cash.movement.record', 'Register', 'Cash movements', 'Operate', 'Record cash paid in, paid out and drops', ['cash.read']),
  capability('cash.movement.approve', 'Register', 'Cash movements', 'Approve', 'Independently approve cash movements', ['cash.read']),
  capability('students.read', 'Students', 'Student accounts', 'View', 'Find and view student identity and account readiness'),
  capability('students.enroll', 'Students', 'Enrollment', 'Operate', 'Enroll a student or complete roster enrollment', ['students.read', 'credentials.issue']),
  capability('students.status.manage', 'Students', 'Student accounts', 'Manage', 'Deactivate and reactivate student accounts', ['students.read']),
  capability('credentials.read', 'Students', 'Credentials', 'View', 'View card and PIN readiness', ['students.read']),
  capability('credentials.issue', 'Students', 'Initial credentials', 'Operate', 'Issue initial card and PIN during enrollment', ['credentials.read']),
  capability('credentials.reset', 'Students', 'PIN reset', 'Manage', 'Reset an existing PIN with independent approval', ['credentials.read']),
  capability('credentials.card.replace', 'Students', 'Card replacement', 'Manage', 'Replace an existing card with independent approval', ['credentials.read']),
  capability('credentials.approve', 'Students', 'Credentials', 'Approve', 'Independently approve credential changes', ['credentials.read']),
  capability('wallet.read', 'Students', 'Wallets', 'View', 'View student balances and wallet history', ['students.read']),
  capability('wallet.fund', 'Students', 'Wallets', 'Operate', 'Accept a normal cash student deposit', ['wallet.read']),
  capability('wallet.correct', 'Students', 'Wallet corrections', 'Manage', 'Initiate an independently approved wallet credit or debit', ['wallet.read']),
  capability('wallet.reverse', 'Students', 'Funding reversals', 'Manage', 'Reverse an exact funding receipt with independent approval', ['wallet.read']),
  capability('wallet.approve', 'Students', 'Wallet corrections', 'Approve', 'Independently approve wallet corrections and reversals', ['wallet.read']),
  capability('inventory.read', 'Inventory', 'Products and stock', 'View', 'View products, stock and lots'),
  capability('inventory.receive', 'Inventory', 'Stock receiving', 'Operate', 'Receive stock', ['inventory.read']),
  capability('inventory.adjust', 'Inventory', 'Stock removal', 'Operate', 'Record documented stock removal', ['inventory.read']),
  capability('inventory.product.manage', 'Inventory', 'Products and stock', 'Manage', 'Create, edit, archive and restore products', ['inventory.read']),
  capability('inventory.price.manage', 'Inventory', 'Product pricing', 'Manage', 'Change product prices', ['inventory.read']),
  capability('coupons.read', 'Inventory', 'Coupons', 'View', 'View coupon definitions'),
  capability('coupons.manage', 'Inventory', 'Coupons', 'Manage', 'Create and deactivate coupons', ['coupons.read']),
  capability('refunds.read', 'Finance', 'Refunds', 'View', 'View original sales and refund receipts'),
  capability('refunds.issue', 'Finance', 'Refunds', 'Operate', 'Issue verified refunds within installed policy', ['refunds.read']),
  capability('refunds.cash_payout', 'Finance', 'Refund cash handover', 'Operate', 'Record an authorized refund cash handover', ['refunds.read']),
  capability('reports.sales', 'Finance', 'Sales reports', 'View', 'View sales reports'),
  capability('reports.inventory', 'Finance', 'Inventory reports', 'View', 'View inventory reports'),
  capability('reports.wallets', 'Finance', 'Wallet reports', 'View', 'View wallet reports'),
  capability('reports.coupons', 'Finance', 'Coupon reports', 'View', 'View coupon reports'),
  capability('reconciliation.read', 'Finance', 'Reconciliation', 'View', 'Review and export daily reconciliation'),
  capability('cash.history.all', 'Finance', 'Cash history', 'View', 'View cash history across registers', ['cash.read']),
  capability('cash.variance.review', 'Finance', 'Cash variances', 'Approve', 'Independently review cash count variances', ['cash.history.all']),
  capability('staff.read', 'Admin', 'Staff', 'View', 'View staff profiles'),
  capability('staff.manage', 'Admin', 'Staff', 'Manage', 'Manage staff profiles, credentials and sessions', ['staff.read']),
  capability('staff.access.manage', 'Admin', 'Employee access', 'Manage', 'Assign exact employee access; Super Admin only', ['staff.manage']),
  capability('terminals.read', 'Admin', 'Registers', 'View', 'View registered terminals'),
  capability('terminals.manage', 'Admin', 'Registers', 'Manage', 'Rename, deactivate and revoke terminal sessions', ['terminals.read']),
  capability('settings.payments.manage', 'Admin', 'Payment settings', 'Manage', 'Configure this register’s payment policy'),
  capability('audit.read', 'Admin', 'Access audit', 'View', 'View immutable employee access history', ['staff.read']),
] as const
export type Capability = typeof CAPABILITIES[number]['name']
export const CAPABILITY_NAMES = CAPABILITIES.map(c => c.name)
const all = [...CAPABILITY_NAMES]
export const PRESET_DEFAULTS: Readonly<Record<AccessPreset, readonly Capability[]>> = {
  staff: ['pos.read', 'pos.checkout', 'coupons.redeem'],
  manager: ['pos.read', 'pos.checkout', 'coupons.redeem', 'orders.read', 'orders.fulfill', 'cash.read', 'cash.shift.manage', 'cash.movement.record', 'students.read', 'inventory.read', 'inventory.receive', 'inventory.adjust', 'inventory.product.manage', 'inventory.price.manage', 'coupons.read', 'coupons.manage', 'refunds.read', 'refunds.issue', 'reports.sales', 'reports.inventory', 'reports.coupons'],
  accountant: ['students.read', 'wallet.read', 'wallet.fund', 'cash.read', 'cash.shift.manage', 'cash.movement.record', 'cash.movement.approve', 'cash.history.all', 'cash.variance.review', 'refunds.read', 'reports.sales', 'reports.inventory', 'reports.wallets', 'reports.coupons', 'reconciliation.read'],
  super_admin: all,
}
export function accessDiff(before: readonly Capability[], after: readonly Capability[]) {
  return { added: after.filter(c => !before.includes(c)), removed: before.filter(c => !after.includes(c)) }
}
export function setCapability(current: readonly Capability[], name: Capability, selected: boolean) {
  const next = new Set<Capability>(current)
  const added: Capability[] = []
  function include(n: Capability) {
    if (next.has(n)) return
    next.add(n); added.push(n)
    for (const prerequisite of CAPABILITIES.find(c => c.name === n)?.requires ?? []) include(prerequisite as Capability)
  }
  if (selected) include(name)
  else {
    next.delete(name)
    let changed = true
    while (changed) {
      changed = false
      for (const c of CAPABILITIES) if (next.has(c.name) && c.requires.some(r => !next.has(r as Capability))) { next.delete(c.name); changed = true }
    }
  }
  return { permissions: CAPABILITY_NAMES.filter(n => next.has(n)), prerequisites: added.filter(n => n !== name) }
}
export function validCapabilities(permissions: readonly string[]) {
  return new Set(permissions).size === permissions.length && permissions.every(n => {
    const definition = CAPABILITIES.find(c => c.name === n)
    return definition && definition.requires.every(r => permissions.includes(r))
  })
}
export function effectiveAccess(permissions: readonly Capability[]) {
  return (['Register', 'Students', 'Inventory', 'Finance', 'Admin'] as const).map(workspace => ({ workspace, actions: CAPABILITIES.filter(c => c.workspace === workspace && permissions.includes(c.name)) }))
}
