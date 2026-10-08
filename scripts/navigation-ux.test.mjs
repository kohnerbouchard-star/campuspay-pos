import { test } from 'node:test'
import assert from 'node:assert/strict'
import { WORKSPACE_LINKS, WORKSPACE_GROUPS, canAccessWorkspace, activeWorkspace, workspaceGroups } from '../src/features/auth/navigation.ts'
import {PRESET_DEFAULTS,setCapability} from '../src/features/auth/capabilities.ts'
import { activeCustomerDestination, safeCustomerDestination } from '../src/features/store/navigation.ts'

const expected={staff:['Register'],manager:['Register','Students','Inventory','Finance'],accountant:['Register','Students','Finance'],super_admin:['Register','Students','Inventory','Finance','Admin']}
for(const [preset,permissions] of Object.entries(PRESET_DEFAULTS))test(`${preset}: workspaces follow effective capabilities`,()=>{
 const links=WORKSPACE_LINKS.filter(l=>canAccessWorkspace(permissions,l));assert.deepEqual(links.map(l=>l.label),expected[preset]);assert.deepEqual(workspaceGroups(links).flatMap(g=>g.links),links)
})
test('customized Staff with Orders has only Register',()=>{const p=setCapability(PRESET_DEFAULTS.staff,'orders.fulfill',true).permissions;assert.deepEqual(WORKSPACE_LINKS.filter(l=>canAccessWorkspace(p,l)).map(l=>l.label),['Register'])})
test('zero effective capabilities shows no workspaces regardless of preset',()=>assert.equal(WORKSPACE_LINKS.filter(l=>canAccessWorkspace([],l)).length,0))
test('metadata groups five coherent workspaces without introducing external or store destinations', () => {
  assert.equal(WORKSPACE_LINKS.length, 5)
  assert.equal(new Set(WORKSPACE_LINKS.map(link => link.href)).size, 5)
  assert.deepEqual(workspaceGroups(WORKSPACE_LINKS).map(group => group.label), WORKSPACE_GROUPS)
  assert.ok(WORKSPACE_LINKS.every(link => link.description.length > 12 && link.href.startsWith('/') && !link.href.startsWith('//') && !link.href.startsWith('/store')))
  assert.deepEqual(workspaceGroups([]), [])
})
for (const link of WORKSPACE_LINKS) test(`exact and trailing-slash active state: ${link.href}`, () => {
  assert.equal(activeWorkspace(link.href, WORKSPACE_LINKS)?.href, link.href)
  assert.equal(activeWorkspace(link.href + '/', WORKSPACE_LINKS)?.href, link.href)
})
for (const [path, parent] of [
  ['/cash/history', '/finance'], ['/refunds/items', '/finance'], ['/students/550e8400-e29b-41d4-a716-446655440000/complete', '/students'],
]) test(`nested page stays in its parent workspace: ${path}`, () => assert.equal(activeWorkspace(path, WORKSPACE_LINKS)?.href, parent))
for (const path of ['/cashier', '/orders-extra', '/students2', '/api/orders', '/store/orders', '/unknown', '/', 'https://example.com/pos']) {
  test(`unrelated path does not highlight a staff workspace: ${path}`, () => assert.equal(activeWorkspace(path, WORKSPACE_LINKS), undefined))
}
test('a nested unauthorized route cannot leak into a role-filtered menu', () => {
  const links = WORKSPACE_LINKS.filter(link => canAccessWorkspace(PRESET_DEFAULTS.staff, link))
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
