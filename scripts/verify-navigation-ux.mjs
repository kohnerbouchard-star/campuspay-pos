#!/usr/bin/env node
// Browser and route audit against an isolated local production build. Never school data.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { randomBytes, randomUUID } from 'node:crypto'
import { chromium, expect } from '@playwright/test'
import { refundTestContext } from './refund-test-context.mjs'

const dir = '.validation/navigation-ux'
fs.mkdirSync(dir, { recursive: true })
let ctx, browser, phase = 'setup', page
const checks = [], pages = [], pageErrors = []
const matrix = [
 ['1001','/pos',['/register']],
 ['2001','/inventory',['/register','/students','/inventory','/finance']],
 ['3001','/students',['/register','/students','/finance']],
 ['9001','/pos',['/register','/students','/inventory','/finance','/admin']],
]
const parent=route=>route.startsWith('/cash/history')||['/refunds','/reconciliation','/reports'].some(p=>route===p||route.startsWith(p+'/'))?'/finance':['/pos','/orders','/cash'].some(p=>route===p||route.startsWith(p+'/'))?'/register':['/students','/security','/funding'].some(p=>route===p||route.startsWith(p+'/'))?'/students':['/inventory','/coupons'].some(p=>route===p||route.startsWith(p+'/'))?'/inventory':'/admin'
const capture = async (name, width = 1440) => {
  await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 })
  await page.evaluate(() => window.scrollTo(0, 0))
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `No horizontal page overflow: ${name}`)
  await page.screenshot({ path: `${dir}/${name}-${width}.png`, fullPage: !name.startsWith('menu-'), animations: 'disabled' })
}
try {
  ctx = await refundTestContext(); await ctx.start(false)
  browser = await chromium.launch({ headless: true })
  const admin = await ctx.login()
  const card = randomBytes(12).toString('hex')
  await ctx.request(admin, '/api/students', { studentCode: `UX-${randomBytes(5).toString('hex')}`, displayName: 'Navigation test student', cardRead: card, pin: ctx.pin, confirmationPin: ctx.pin, idempotencyKey: randomUUID() }, 201)
  const customer = new Map()
  await ctx.request(customer, '/api/store/login', { cardNumber: card, pin: ctx.pin })
  const roster = (await ctx.owner.query("insert into private.students(student_code, display_name, year_group, academic_year) values($1,'Navigation roster entry',10,'2026-2027') returning id", [`UX-ROSTER-${randomBytes(4).toString('hex')}`])).rows[0].id
  await ctx.owner.query('insert into private.wallets(student_id,balance_won) values($1,0)', [roster])
  const unchanged = async () => JSON.stringify((await ctx.owner.query(`select
    (select md5(string_agg(to_jsonb(t)::text,'' order by t.student_id)) from private.wallets t) wallets,
    (select md5(string_agg(to_jsonb(t)::text,'' order by t.id)) from private.wallet_ledger t) ledger,
    (select md5(string_agg(to_jsonb(t)::text,'' order by t.id)) from private.student_cards t) cards,
    (select md5(string_agg(to_jsonb(t)::text,'' order by t.student_id)) from private.student_credentials t) credentials,
    (select count(*) from private.sales) sales,
    (select md5(string_agg(to_jsonb(t)::text,'' order by t.id)) from private.inventory_lots t) stock`)).rows[0])
  const before = await unchanged()
  const newPage = async cookies => {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' })
    await context.addCookies([...cookies].filter(([, value]) => value).map(([name, value]) => ({ name, value, url: ctx.base })))
    page = await context.newPage(); page.setDefaultTimeout(12000)
    page.on('pageerror', error => pageErrors.push(error.message))
    return context
  }
  for (const [code, start, routes] of matrix) {
    phase = `role menu ${code}`
    const context = await newPage(await ctx.login(code))
    await page.goto(ctx.base + start, { waitUntil: 'networkidle' })
    const rail = page.getByRole('complementary', { name: 'Staff navigation', exact: true })
    const nav = rail.getByRole('navigation', { name: 'Permitted workspaces' })
    assert.deepEqual((await nav.locator('a').evaluateAll(links => links.map(link => link.getAttribute('href')))).sort(), [...routes].sort())
    await expect(nav.locator('[data-active]')).toHaveCount(1)
    await expect(nav.locator('[data-active]')).toHaveAttribute('href', parent(start))
    await expect(page.getByRole('navigation', { name: 'Breadcrumb' })).toBeVisible()
    await expect(rail.getByRole('button', { name: 'Sign out', exact: true })).toBeVisible()
    await capture(`role-${code}`)
    await page.setViewportSize({ width: 390, height: 844 })
    await expect(rail).toBeHidden()
    const menu = page.getByRole('button', { name: 'Menu', exact: true })
    await menu.click()
    const dialog = page.getByRole('dialog', { name: 'Workspaces', exact: true })
    await expect(dialog).toBeVisible(); await expect(menu).toHaveAttribute('aria-expanded', 'true')
    const box = await dialog.boundingBox()
    assert.ok(box && Math.abs(box.x) <= 1 && Math.abs(box.width - 390) <= 1 && Math.abs(box.height - 844) <= 1, 'Mobile menu fills the viewport without the native dialog width clamp')
    assert.ok(await dialog.getByRole('navigation').locator('a').evaluateAll(links => links.every(link => link.getBoundingClientRect().height >= 44)), 'Mobile navigation retains 44px targets')
    assert.deepEqual((await dialog.getByRole('navigation').locator('a').evaluateAll(links => links.map(link => link.getAttribute('href')))).sort(), [...routes].sort())
    for (const key of ['Tab', 'Shift+Tab']) for (let i = 0; i < routes.length + 3; i++) {
      await page.keyboard.press(key)
      assert.ok(await dialog.evaluate(node => node.contains(document.activeElement)), `Menu focus remains inside: ${code}`)
      assert.ok(await page.evaluate(() => { const r = document.activeElement.getBoundingClientRect(); return r.bottom > 0 && r.top < innerHeight }), 'Focused menu control is visible')
    }
    await dialog.evaluate(node => { node.scrollTop = 0 })
    await capture(`menu-${code}`, 390)
    await page.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0); await expect(menu).toBeFocused()
    assert.notEqual(await page.evaluate(() => document.body.style.overflow), 'hidden')
    await menu.click()
    const destination = routes.find(route => route !== parent(start))??routes[0]
    await page.getByRole('dialog', { name: 'Workspaces' }).locator(`a[href="${destination}"]`).click()
    await expect.poll(()=>parent(new URL(page.url()).pathname)).toBe(destination)
    await expect(page.getByRole('dialog', { name: 'Workspaces' })).toHaveCount(0)
    await expect(page.getByRole('navigation', { name: 'Breadcrumb' })).toBeVisible()
    await context.close()
  }
  checks.push('All four roles retain exactly their authorized links; mobile menu supports keyboard focus, Escape, restoration and navigation')

  phase = 'all staff screens and nested navigation'
  const adminContext = await newPage(admin)
  const routes = ['/pos','/orders','/students','/inventory','/coupons','/funding','/cash','/cash/movements','/refunds','/reconciliation','/reports','/security','/administration','/settings/payments','/cash/history','/refunds/items',`/students/${roster}/complete`]
  for (const route of routes) {
    phase = `route ${route}`
    const response = await page.goto(ctx.base + route, { waitUntil: 'networkidle' })
    assert.equal(response.status(), 200)
    assert.equal(new URL(page.url()).pathname, route)
    await expect(page.getByRole('main')).toHaveCount(1)
    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1)
    const expected = parent(route)
    const nav = page.getByRole('navigation', { name: 'Permitted workspaces' })
    await expect(nav.locator('[data-active]')).toHaveCount(1)
    await expect(nav.locator('[data-active]')).toHaveAttribute('href', expected)
    await expect(nav.locator('[data-active]')).toHaveAttribute('aria-current', route === expected ? 'page' : 'location')
    if (route !== expected) await expect(page.getByRole('navigation', { name: 'Breadcrumb' }).locator(`a[href="${expected}"]`)).toBeVisible()
    const name = route.includes(roster) ? 'complete-enrollment' : route.slice(1).replaceAll('/', '-')
    await capture(name); await capture(name, 390)
    pages.push(route.includes(roster) ? '/students/[studentId]/complete' : route)
    await page.setViewportSize({ width: 1440, height: 1000 })
  }
  checks.push('Every one of the 17 authorized staff pages loads with a single main/heading, correct parent navigation and desktop/mobile layout')

  phase = 'report shortcuts and inventory task groups'
  await page.goto(ctx.base + '/reports', { waitUntil: 'networkidle' })
  const reportNav = page.getByRole('navigation', { name: 'Jump to report' })
  await expect(reportNav.locator('a')).toHaveCount(4)
  for (const link of await reportNav.locator('a').all()) {
    const anchor = await link.getAttribute('href')
    await link.click(); await expect(page.locator(anchor)).toBeFocused()
  }
  await page.goto(ctx.base + '/inventory', { waitUntil: 'networkidle' })
  await page.getByRole('row').filter({hasText:'WATER-001'}).getByRole('button').click()
  await page.getByRole('button',{name:'Receive Stock',exact:true}).click()
  await expect(page.getByRole('combobox',{name:'Product',exact:true})).not.toHaveValue('')
  checks.push('Report jump links move focus; receiving begins on the selected product without searching again')

  phase = 'short desktop and resize menu'
  await page.goto(ctx.base + '/pos', { waitUntil: 'networkidle' })
  await page.setViewportSize({ width: 1280, height: 600 })
  const lastLink = page.getByRole('navigation', { name: 'Permitted workspaces' }).locator('a').last()
  await lastLink.focus()
  assert.ok(await lastLink.evaluate(node => { const r = node.getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight }))
  await expect(page.getByRole('complementary', { name: 'Staff navigation' }).getByRole('button', { name: 'Sign out', exact: true })).toBeInViewport()
  await page.setViewportSize({ width: 768, height: 1024 })
  await page.getByRole('button', { name: 'Menu', exact: true }).click()
  await page.setViewportSize({ width: 1440, height: 1000 })
  await expect(page.getByRole('dialog', { name: 'Workspaces' })).toHaveCount(0)
  assert.notEqual(await page.evaluate(() => document.body.style.overflow), 'hidden')
  await expect(page.getByRole('complementary', { name: 'Staff navigation' })).toBeVisible()
  const skip = page.getByRole('link', { name: 'Skip to workspace', exact: true })
  await skip.focus(); await page.keyboard.press('Enter')
  assert.equal(await page.evaluate(() => document.activeElement.id), 'workspace-content')
  checks.push('Short desktop rail keeps navigation and sign-out reachable; resizing releases modal focus/scroll; skip link works')
  await adminContext.close()

  phase = 'store and login surfaces'
  const storeContext = await newPage(customer)
  for (const route of ['/store', '/store/orders', '/store/account']) {
    const response = await page.goto(ctx.base + route, { waitUntil: 'networkidle' })
    assert.equal(response.status(), 200)
    const nav = page.getByRole('navigation', { name: 'Student store', exact: true })
    await expect(nav.locator('[aria-current="page"]')).toHaveAttribute('href', route)
    assert.deepEqual(await nav.locator('a').evaluateAll(links => links.map(link => link.getAttribute('href'))), ['/store', '/store/orders', '/store/account'])
    await expect(page.getByText('Wallet balance', { exact: true }).first()).toBeVisible()
    await capture(route.slice(1).replaceAll('/', '-')); await capture(route.slice(1).replaceAll('/', '-'), 390)
    pages.push(route)
    const skip = page.getByRole('link', { name: 'Skip to content', exact: true })
    await skip.focus(); await page.keyboard.press('Enter')
    assert.equal(await page.evaluate(() => document.activeElement.id), 'store-content')
    await page.setViewportSize({ width: 1440, height: 1000 })
  }
  await storeContext.close()
  const anonymousContext = await newPage(new Map())
  for (const route of ['/login', '/store/login']) {
    assert.equal((await page.goto(ctx.base + route, { waitUntil: 'networkidle' })).status(), 200)
    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1)
    await capture(route.slice(1).replaceAll('/', '-')); await capture(route.slice(1).replaceAll('/', '-'), 390)
    pages.push(route)
    await page.setViewportSize({ width: 1440, height: 1000 })
  }
  // The root page keeps its role-specific redirect; verify with an authenticated browser.
  await anonymousContext.addCookies([...admin].filter(([, value]) => value).map(([name, value]) => ({ name, value, url: ctx.base })))
  await page.goto(ctx.base + '/', { waitUntil: 'networkidle' })
  await expect(page).toHaveURL(ctx.base + '/pos')
  pages.push('/')
  await anonymousContext.close()
  assert.equal(await unchanged(), before)
  assert.deepEqual(pageErrors, [])
  checks.push('Customer navigation remains isolated; wallet label and skip links work; no navigation changes to financial or credential records')
  fs.writeFileSync(`${dir}/results.json`, JSON.stringify({ checks, pages, pageErrors, syntheticLocalhostOnly: true, widths: [390, 768, 1280, 1440] }, null, 2))
  console.log(`Navigation UX acceptance passed: ${checks.length} groups; ${pages.length} routes.`)
} catch (error) {
  fs.writeFileSync(`${dir}/failure.txt`, `Phase: ${phase}\n${error.stack ?? 'unknown'}`)
  if (page && !page.isClosed()) await page.screenshot({ path: `${dir}/failure.png`, fullPage: true }).catch(() => {})
  console.error(`Navigation UX failed at ${phase}: ${error.message}`); process.exitCode = 1
} finally { if (browser) await browser.close(); if (ctx) await ctx.close() }
