// Rendered route/role evidence; synthetic localhost only, never a live-site audit.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { randomBytes, randomUUID } from 'node:crypto'
import { chromium, expect } from '@playwright/test'
import { refundTestContext } from './refund-test-context.mjs'

const phase = process.env.VISUAL_REVIEW_PHASE || 'before'
assert.match(phase, /^(before|after)$/)
const directory = `.validation/visual-review/${phase}`
fs.mkdirSync(directory, { recursive: true })
for (const file of ['results.json', 'failure.json']) fs.rmSync(`${directory}/${file}`, { force: true })
let ctx, browser
const screens = [], errors = []
try {
  ctx = await refundTestContext(); await ctx.start(false)
  browser = await chromium.launch({ headless: true })
  const admin = await ctx.login(), card = randomBytes(12).toString('hex')
  const student = await ctx.request(admin, '/api/students', { studentCode: 'VISUAL-001', displayName: 'Synthetic visual review student', cardRead: card, pin: ctx.pin, confirmationPin: ctx.pin, idempotencyKey: randomUUID() }, 201)
  const customer = new Map(); await ctx.request(customer, '/api/store/login', { cardNumber: card, pin: ctx.pin })
  const roster = (await ctx.owner.query("insert into private.students(student_code,display_name,year_group,academic_year) values('VISUAL-ROSTER','Synthetic roster review',10,'2026-2027') returning id")).rows[0].id
  await ctx.owner.query('insert into private.wallets(student_id,balance_won) values($1,0)', [roster])
  async function inspect(page, name) {
    for (const width of [1440, 390, 320]) {
      await page.setViewportSize({ width, height: width === 1440 ? 1000 : 844 })
      await page.evaluate(() => window.scrollTo(0, 0))
      const metrics = await page.evaluate(() => {
        const visible = element => element.getClientRects().length && getComputedStyle(element).visibility !== 'hidden'
        const controls = [...document.querySelectorAll('button,a,input,select,textarea,summary')].filter(visible)
        const rgb = value => value.match(/[\d.]+/g)?.map(Number)
        const luminance = color => color.slice(0,3).map(v => v / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4).reduce((sum,v,i) => sum + v * [.2126,.7152,.0722][i], 0)
        const contrastCandidates = []
        for (const element of document.querySelectorAll('body *')) {
          if (!visible(element) || element.closest(':disabled,[inert]') || ![...element.childNodes].some(node => node.nodeType === Node.TEXT_NODE && node.textContent.trim())) continue
          const box = element.getBoundingClientRect(); if (box.width < 3 || box.height < 3) continue
          const style = getComputedStyle(element), foreground = rgb(style.color)
          let background, uncertain = false
          for (let ancestor = element; ancestor; ancestor = ancestor.parentElement) {
            const css = getComputedStyle(ancestor)
            if (css.backgroundImage !== 'none' || Number(css.opacity) !== 1) { uncertain = true; break }
            const color = rgb(css.backgroundColor)
            if (!background && color && (color.length === 3 || color[3] === 1)) background = color
            else if (!background && color && color[3] > 0) { uncertain = true; break }
          }
          if (uncertain || !background || !foreground || foreground.length === 4 && foreground[3] !== 1) continue
          const a = luminance(foreground), b = luminance(background), ratio = (Math.max(a,b)+.05)/(Math.min(a,b)+.05)
          const minimum = parseFloat(style.fontSize) >= 24 || parseFloat(style.fontSize) >= 18.667 && Number(style.fontWeight) >= 700 ? 3 : 4.5
          if (ratio < minimum) contrastCandidates.push({ text: element.textContent.trim().slice(0,70), ratio, minimum, foreground: style.color, background })
        }
        return {
          overflow: document.documentElement.scrollWidth - innerWidth,
          contrastCandidates,
          headings: [...document.querySelectorAll('h1,h2,h3')].filter(visible).map(e => e.textContent),
          smallTargets: controls.filter(e => !e.matches(':disabled')).map(e => ({ name: e.getAttribute('aria-label') || e.textContent?.trim().slice(0,70), width: e.getBoundingClientRect().width, height: e.getBoundingClientRect().height })).filter(e => e.width < 24 || e.height < 24),
          unnamedFields: controls.filter(e => e.matches('input:not([type=hidden]),select,textarea') && !e.getAttribute('aria-label') && !e.getAttribute('aria-labelledby') && !e.labels?.length).map(e => e.outerHTML.slice(0,150)),
          tables: [...document.querySelectorAll('table')].filter(visible).map(e => ({ headers: [...e.querySelectorAll('th')].map(h => h.textContent), scrollContained: e.parentElement.scrollWidth > e.parentElement.clientWidth && ['auto','scroll'].includes(getComputedStyle(e.parentElement).overflowX) }))
        }
      })
      const file = `${directory}/${name}-${width}.png`
      await page.screenshot({ path: file, fullPage: true, animations: 'disabled' })
      screens.push({ name, width, path: new URL(page.url()).pathname.replace(roster, '[studentId]'), file, ...metrics })
      if (phase === 'after') assert.ok(metrics.overflow <= 1, `${name} at ${width}px must reflow without page overflow: ${metrics.overflow}`)
    }
  }
  async function withPage(cookies, callback) {
    const context = await browser.newContext({ reducedMotion: 'reduce' })
    await context.addCookies([...cookies].filter(([, value]) => value).map(([name, value]) => ({ name, value, url: ctx.base })))
    try {
      const page = await context.newPage(); page.setDefaultTimeout(15000)
      page.on('pageerror', e => errors.push(e.message))
      await callback(page)
    } finally { await context.close() }
  }
  await withPage(admin, async page => {
    for (const route of ['/pos','/orders','/students','/inventory','/coupons','/funding','/cash','/cash/movements','/refunds','/refunds/items','/reconciliation','/reports','/security','/administration','/settings/payments','/cash/history',`/students/${roster}/complete`]) {
      await page.goto(ctx.base + route, { waitUntil: 'networkidle' })
      await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1)
      await inspect(page, route.includes(roster) ? 'complete-enrollment' : route.slice(1).replaceAll('/', '-'))
    }
    await page.goto(ctx.base + '/reports', { waitUntil: 'networkidle' })
    for (const report of ['inventory-report','wallet-report','coupon-report']) {
      await page.getByRole('combobox', { name: 'Report', exact: true }).selectOption(report)
      await page.getByRole('button', { name: 'Open report', exact: true }).click()
      await page.waitForURL(url => url.searchParams.get('report') === report)
      await page.waitForLoadState('networkidle'); await inspect(page, report)
    }
    await page.goto(ctx.base + '/students', { waitUntil: 'networkidle' })
    await page.locator('#student-select-' + student.student_id).click()
    await expect(page.getByRole('dialog', { name: /Student account/ })).toBeVisible()
    await inspect(page, 'student-account')
    await page.keyboard.press('Escape')
    await ctx.owner.query("update public.products set name=$1 where sku='WATER-001'", ['Synthetic extra-long sparkling water and reusable bottle multipack for the school afternoon club'])
    await page.goto(ctx.base + '/pos', { waitUntil: 'networkidle' })
    await page.getByRole('button', { name: /Synthetic extra-long/ }).click()
    await inspect(page, 'pos-long-name-cart')
    await ctx.owner.query("update public.products set selling_price_won=99999999 where sku='WATER-001'")
    await page.reload({ waitUntil: 'networkidle' })
    await page.getByRole('button', { name: /Synthetic extra-long/ }).click()
    const quantity = page.getByRole('spinbutton', { name: /Synthetic extra-long.*quantity/ })
    await quantity.fill('40'); await quantity.press('Enter')
    await inspect(page, 'pos-large-amount-cart')
    await ctx.owner.query("update public.products set selling_price_won=1200 where sku='WATER-001'")
    for (const route of ['/','/register','/finance','/admin','/accounting']) {
      await page.goto(ctx.base + route, { waitUntil: 'networkidle' })
      screens.push({ name: `redirect-${route}`, finalPath: new URL(page.url()).pathname })
    }
  })
  for (const [code, route, role] of [['1001','/pos','cashier'],['2001','/inventory','inventory-admin'],['3001','/students','accountant']]) {
    await withPage(await ctx.login(code), async page => { await page.goto(ctx.base + route, { waitUntil: 'networkidle' }); await inspect(page, `role-${role}`) })
  }
  await withPage(customer, async page => {
    for (const route of ['/store','/store/orders','/store/account']) { await page.goto(ctx.base + route, { waitUntil: 'networkidle' }); await inspect(page, route.slice(1).replaceAll('/', '-')) }
  })
  await withPage(new Map(), async page => {
    for (const route of ['/login','/store/login','/access-unavailable']) {
      await page.goto(ctx.base + route, { waitUntil: 'networkidle' })
      if (route === '/access-unavailable' && phase === 'after') assert.equal(new URL(page.url()).pathname, '/login')
      await inspect(page, route === '/access-unavailable' ? 'signed-out-access' : route.slice(1).replaceAll('/', '-'))
    }
  })
  await ctx.owner.query("update private.staff_access set permissions='{}' where user_id=(select auth_user_id from public.staff_profiles where employee_code='1001')")
  await withPage(await ctx.login('1001'), async page => {
    await page.goto(ctx.base + '/access-unavailable', { waitUntil: 'networkidle' })
    await expect(page.getByRole('heading', { name: 'No workspaces assigned', exact: true })).toBeVisible()
    await inspect(page, 'access-unavailable')
  })
  assert.deepEqual(errors, [])
  fs.writeFileSync(`${directory}/results.json`, JSON.stringify({ phase, screens, errors, syntheticOnly: true }, null, 2))
  console.log(`Visual inventory: ${screens.filter(s => s.file).length} screenshots, ${screens.filter(s => s.overflow > 1).length} overflow cases; ${errors.length} browser errors.`)
} catch (error) {
  fs.writeFileSync(`${directory}/failure.json`, JSON.stringify({ error: error.message, screens }, null, 2)); throw error
} finally { await browser?.close(); await ctx?.close() }
