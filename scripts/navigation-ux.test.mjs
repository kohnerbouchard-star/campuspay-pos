import { test } from 'node:test'
import assert from 'node:assert/strict'
import { WORKSPACE_LINKS, WORKSPACE_GROUPS, canAccessWorkspace, activeWorkspace, workspaceGroups } from '../src/features/auth/navigation.ts'
import { ROLE_PERMISSIONS, defaultWorkspace } from '../src/features/auth/permissions.ts'
import { activeCustomerDestination, safeCustomerDestination } from '../src/features/store/navigation.ts'

const expected = {
  cashier: ['/pos', '/orders', '/funding', '/cash'],
  inventory_admin: ['/orders', '/inventory', '/coupons', '/reports', '/security'],
  accountant: ['/accounting', '/funding', '/cash', '/refunds', '/reconciliation', '/reports', '/security'],
  super_admin: ['/pos', '/orders', '/students', '/inventory', '/coupons', '/accounting', '/funding', '/cash', '/refunds', '/reconciliation', '/reports', '/security', '/administration', '/settings/payments'],
}
for (const [role, permissions] of Object.entries(ROLE_PERMISSIONS)) {
  test(`${role}: navigation keeps exactly the pre-existing permission boundary`, () => {
    const links = WORKSPACE_LINKS.filter(link => canAccessWorkspace(permissions, link))
    assert.deepEqual(links.map(link => link.href), expected[role])
    const groups = workspaceGroups(links)
    assert.ok(groups.every(group => group.links.length > 0))
    assert.deepEqual(groups.flatMap(group => group.links).map(link => link.href).sort(), [...expected[role]].sort())
    assert.ok(links.some(link => link.href === defaultWorkspace(role)))
  })
}
test('metadata groups every existing route once without introducing external or store destinations', () => {
  assert.equal(WORKSPACE_LINKS.length, 14)
  assert.equal(new Set(WORKSPACE_LINKS.map(link => link.href)).size, 14)
  assert.deepEqual(workspaceGroups(WORKSPACE_LINKS).map(group => group.label), WORKSPACE_GROUPS)
  assert.ok(WORKSPACE_LINKS.every(link => link.description.length > 12 && link.href.startsWith('/') && !link.href.startsWith('//') && !link.href.startsWith('/store')))
  assert.deepEqual(workspaceGroups([]), [])
})
for (const link of WORKSPACE_LINKS) test(`exact and trailing-slash active state: ${link.href}`, () => {
  assert.equal(activeWorkspace(link.href, WORKSPACE_LINKS)?.href, link.href)
  assert.equal(activeWorkspace(link.href + '/', WORKSPACE_LINKS)?.href, link.href)
})
for (const [path, parent] of [
  ['/cash/history', '/cash'], ['/refunds/items', '/refunds'], ['/students/550e8400-e29b-41d4-a716-446655440000/complete', '/students'],
]) test(`nested page stays in its parent workspace: ${path}`, () => assert.equal(activeWorkspace(path, WORKSPACE_LINKS)?.href, parent))
for (const path of ['/cashier', '/orders-extra', '/students2', '/api/orders', '/store/orders', '/unknown', '/', 'https://example.com/pos']) {
  test(`unrelated path does not highlight a staff workspace: ${path}`, () => assert.equal(activeWorkspace(path, WORKSPACE_LINKS), undefined))
}
test('a nested unauthorized route cannot leak into a role-filtered menu', () => {
  const links = WORKSPACE_LINKS.filter(link => canAccessWorkspace(ROLE_PERMISSIONS.cashier, link))
  assert.equal(activeWorkspace('/students/synthetic/complete', links), undefined)
})
for (const [path, expectedPage] of [
  ['/', '/store'], ['/orders', '/store/orders'], ['/account', '/store/account'], ['/store', '/store'],
  ['/store/orders', '/store/orders'], ['/store/account', '/store/account'], ['/orders/', '/store/orders'],
  ['/account/', '/store/account'], ['/store/', '/store'], ['/store/orders/', '/store/orders'],
]) test(`store alias identifies the same selected destination: ${path}`, () => assert.equal(activeCustomerDestination(path), expectedPage))
for (const path of ['/pos', '/api/store/login', '/store/login', '/orders-extra', '//evil.example/store']) {
  test(`non-store page has no selected customer navigation: ${path}`, () => assert.equal(activeCustomerDestination(path), null))
}
test('display aliases do not expand post-login redirect permissions', () => {
  assert.equal(safeCustomerDestination('/orders'), '/store')
  assert.equal(safeCustomerDestination('//evil.example/store'), '/store')
  assert.equal(safeCustomerDestination('/store/orders'), '/store/orders')
})
