// Real app, disposable database and fake local product storage only.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { chromium, expect } from '@playwright/test'
import { photoContext, photoReason } from './product-photo-context.mjs'

let ctx, browser
const checks = [], directory = '.validation/forced-photo-exit'
fs.mkdirSync(directory, { recursive: true })
try {
  ctx = await photoContext(); await ctx.start(false)
  browser = await chromium.launch({ headless: true })
  for (const width of [1440, 390]) for (const mode of ['failed-staged', 'confirmed-local', 'expired-local', 'manual-confirmed-local']) {
    const cookies = await ctx.login(), context = await browser.newContext({ viewport: { width, height: 900 } })
    try {
      await context.addCookies([...cookies].filter(([, value]) => value).map(([name, value]) => ({ name, value, url: ctx.base })))
      const page = await context.newPage(), dialogs = [], errors = [], writes = []
      page.setDefaultTimeout(15000)
      page.on('pageerror', error => errors.push(error.message))
      page.on('dialog', async dialog => { dialogs.push(dialog.type()); await dialog.dismiss() })
      page.on('request', request => { if (request.method() !== 'GET' && /\/photo(?:\/cancel)?$/.test(new URL(request.url()).pathname)) writes.push(request.method()) })
      await page.clock.install()
      await page.goto(ctx.base + '/inventory')
      await page.getByRole('button', { name: 'Bottled Water', exact: true }).click()
      await page.locator('summary').filter({ hasText: /^More$/ }).click()
      await page.getByRole('button', { name: 'Edit / Archive', exact: true }).click()
      await page.getByRole('button', { name: 'Edit product', exact: true }).click()
      const editor = page.getByRole('region', { name: 'Product photo', exact: true })
      await expect(editor.getByRole('button', { name: 'Check photo status', exact: true })).toBeEnabled()
      await editor.getByLabel('Choose product photo', { exact: true }).setInputFiles({ name: 'synthetic.png', mimeType: 'image/png', buffer: await ctx.image() })
      await editor.getByRole('textbox', { name: 'Reason for photo change', exact: true }).fill(photoReason)
      if (mode === 'failed-staged') {
        await ctx.rateReset()
        await editor.getByRole('button', { name: 'Upload and validate photo', exact: true }).click()
        await expect(editor.getByRole('button', { name: 'Save photo', exact: true })).toBeEnabled()
      }
      await page.evaluate(() => sessionStorage.setItem('campuspay:refund:v1', 'synthetic-preserved-recovery'))
      const stored = await page.evaluate(() => Object.entries(sessionStorage))
      let release, seen = false
      if (mode === 'failed-staged') {
        const held = new Promise(resolve => { release = resolve })
        await page.route('**/api/auth/logout', async route => {
          seen = true; await held
          await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ ok: false, error: { code: 'INTERNAL_ERROR', message: 'Synthetic failed revocation' } }) })
        }, { times: 1 })
      }
      if (mode === 'expired-local') await page.route('**/api/auth/activity', route => route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ ok: false, error: { code: 'SESSION_EXPIRED', message: 'Synthetic expired heartbeat' } }) }))
      if (width === 390) await page.getByRole('button', { name: 'Menu', exact: true }).click()
      if (mode === 'manual-confirmed-local') await page.getByRole('button', { name: 'Sign out', exact: true }).click()
      else await page.clock.fastForward(mode === 'expired-local' ? 61000 : 15 * 60 * 1000 + 1000)
      if (mode === 'failed-staged') {
        await expect.poll(() => seen).toBe(true)
        await expect(page.getByRole('heading', { name: 'Workspace hidden', exact: true })).toBeVisible()
        await expect(editor).toBeHidden()
        await expect(page.locator('dialog[open]')).toHaveCount(0)
        assert.equal(await page.locator('[data-staff-workspace]').evaluate(element => element.inert && element.hidden), true)
        assert.deepEqual(await page.evaluate(() => Object.entries(sessionStorage)), stored)
        await page.screenshot({ path: `${directory}/concealed-${width}.png` })
        release()
      }
      await page.waitForURL(url => url.pathname === '/login')
      assert.deepEqual(dialogs, [], 'Forced exit must never present a cancellable unsaved prompt')
      assert.deepEqual(await page.evaluate(() => Object.entries(sessionStorage)), stored)
      assert.deepEqual(writes, mode === 'failed-staged' ? ['POST'] : [], 'Exit must not save or cancel a photo')
      if (mode === 'failed-staged') {
        assert.equal(new URL(page.url()).searchParams.get('logout'), 'unconfirmed')
        await ctx.request(cookies, '/api/auth/session')
        await page.getByRole('button', { name: 'Retry sign out', exact: true }).click()
        await page.waitForURL(url => !url.searchParams.has('logout'))
      }
      await ctx.request(cookies, '/api/auth/session', undefined, 401)
      assert.deepEqual(errors, [])
      checks.push(`${width}px ${mode}: concealed exit cannot be cancelled; recovery retained; no photo mutation on exit; revocation verified`)
      if (mode === 'failed-staged') {
        await ctx.login('9001', cookies)
        const product = (await ctx.request(cookies, '/api/pos/catalog')).find(row => row.sku === 'WATER-001')
        const reference = stored.find(([key]) => key.startsWith('campuspay:product-photo:'))
        assert.ok(reference)
        assert.equal((await ctx.read(cookies, product.id, reference[1])).operation.state, 'READY')
        await ctx.cancel(cookies, product.id, reference[1])
      }
    } finally { await context.close() }
  }
  // Delayed recovery must not reopen a native top-layer dialog after concealment.
  for (const width of [1440, 390]) {
    const cookies = await ctx.login(), context = await browser.newContext({ viewport: { width, height: 900 } })
    try {
      await context.addCookies([...cookies].filter(([, value]) => value).map(([name, value]) => ({ name, value, url: ctx.base })))
      const page = await context.newPage(), dialogs = [], errors = []
      page.on('dialog', async dialog => { dialogs.push(dialog.type()); await dialog.dismiss() })
      page.on('pageerror', error => errors.push(error.message))
      const id = '00000000-0000-4000-8000-000000000001'
      await page.addInitScript(id => { if (location.pathname === '/pos') sessionStorage.setItem('campuspay.pendingPayment', id) }, id)
      let releaseRecovery, releaseHeartbeat, releaseLogout, recoverySeen = false
      const recovery = new Promise(resolve => { releaseRecovery = resolve }), heartbeat = new Promise(resolve => { releaseHeartbeat = resolve }), logout = new Promise(resolve => { releaseLogout = resolve })
      await page.route('**/api/auth/activity', async route => { await heartbeat; await route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ ok: false, error: { code: 'SESSION_EXPIRED', message: 'Synthetic heartbeat expiry' } }) }) })
      await page.route('**/api/auth/logout', async route => { await logout; await route.abort() })
      await page.route('**/api/pos/intents/*/recover', async route => {
        recoverySeen = true; await recovery
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, data: { state: 'completed', receipt: { sale_id: id, receipt_number: 'SYNTHETIC-LATE', created_at: new Date().toISOString(), subtotal_won: 1000, discount_won: 0, total_won: 1000, tender_mode: 'WALLET', wallet_tender_won: 1000, balance_after_won: 0 }, items: [{ name: 'Synthetic recovered item', quantity: 1, lineTotalWon: 1000 }] } }) })
      })
      await page.goto(ctx.base + '/pos')
      await expect.poll(() => recoverySeen).toBe(true)
      releaseHeartbeat()
      await expect(page.getByRole('heading', { name: 'Workspace hidden' })).toBeVisible()
      assert.equal(await page.evaluate(() => sessionStorage.getItem('campuspay.pendingPayment')), id)
      releaseRecovery()
      await expect(page.locator('dialog[aria-label="Payment completed"]')).toHaveCount(1)
      await expect(page.locator('dialog[open]')).toHaveCount(0)
      // Confirmed recovery may clear its own marker; concealment itself must not.
      assert.equal(await page.evaluate(() => sessionStorage.getItem('campuspay.pendingPayment')), null)
      await page.getByRole('link', { name: 'Continue to sign in' }).click()
      await page.waitForURL(url => url.pathname === '/login')
      releaseLogout()
      assert.deepEqual(dialogs, []); assert.deepEqual(errors, [])
      checks.push(`${width}px late payment recovery: result stays mounted without opening a modal; exit link remains usable`)
    } finally { await context.close() }
  }
  const roster = (await ctx.owner.query("insert into private.students(student_code,display_name) values('EXIT-ROSTER','Synthetic exit student') returning id")).rows[0].id
  await ctx.owner.query('insert into private.wallets(student_id,balance_won) values($1,0)', [roster])
  for (const width of [1440, 390]) {
    const cookies = await ctx.login(), context = await browser.newContext({ viewport: { width, height: 900 } })
    try {
      await context.addCookies([...cookies].filter(([, value]) => value).map(([name, value]) => ({ name, value, url: ctx.base })))
      const page = await context.newPage(), dialogs = []
      page.on('dialog', async dialog => { dialogs.push(dialog.type()); await dialog.dismiss() })
      await page.goto(ctx.base + '/students')
      await page.locator('#student-select-' + roster).click()
      await page.locator('summary').filter({ hasText: 'More student actions' }).click()
      await page.getByRole('button', { name: 'Manage Status', exact: true }).click()
      await page.getByRole('button', { name: 'Deactivate student', exact: true }).click()
      await page.getByRole('textbox', { name: 'Reason for record change' }).fill('Synthetic draft never submitted')
      await page.evaluate(() => sessionStorage.setItem('campuspay:funding:synthetic', 'retain-unresolved-reference'))
      // First prove this mounted student draft really owns an unload guard.
      assert.equal(await page.evaluate(() => { const event = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(event); return event.defaultPrevented }), true)
      await page.clock.install()
      await page.clock.fastForward(15 * 60 * 1000 + 1000)
      await page.waitForURL(url => url.pathname === '/login')
      assert.deepEqual(dialogs, [])
      assert.equal(await page.evaluate(() => sessionStorage.getItem('campuspay:funding:synthetic')), 'retain-unresolved-reference')
      await ctx.request(cookies, '/api/auth/session', undefined, 401)
      checks.push(`${width}px dirty student status: ordinary unload guarded; forced exit unblocked and unrelated recovery retained`)
    } finally { await context.close() }
  }
  fs.writeFileSync(`${directory}/results.json`, JSON.stringify({ result: 'PASS', checks }, null, 2))
  console.log(`Forced photo exit passed: ${checks.length} groups.`)
} finally { await browser?.close(); await ctx?.close() }
