// Real app, disposable loopback DB and synthetic identities only.
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { chromium, expect } from '@playwright/test'
import { refundTestContext } from './refund-test-context.mjs'
const root = '.validation/workflow-clarity', checks = [], evidence = []
let ctx, browser, phase = 'setup'
await fs.mkdir(root, { recursive: true })
try {
  ctx = await refundTestContext(); await ctx.start(true, { administration: true, partialRefunds: true })
  await ctx.owner.query('update private.system_settings set administration_enabled=true where singleton')
  const admin = await ctx.login(), product = (await ctx.request(admin, '/api/pos/catalog')).find(p => p.sku === 'WATER-001')
  const card = `CLARITY-${randomUUID()}`
  const student = await ctx.request(admin, '/api/students', { studentCode: 'CLARITY-001', displayName: 'Synthetic workflow student', cardRead: card, pin: ctx.pin, confirmationPin: ctx.pin, idempotencyKey: randomUUID() }, 201)
  await ctx.request(admin, '/api/pos/payment-policy', { cashEnabled: true, eventName: 'Synthetic workflow acceptance', endsAt: new Date(Date.now() + 3600000).toISOString() })
  const customer = new Map(); await ctx.request(customer, '/api/store/login', { cardNumber: card, pin: ctx.pin })
  browser = await chromium.launch({ headless: true })
  async function pageFor(cookies, width) {
    const context = await browser.newContext({ viewport: { width, height: 950 } })
    await context.addCookies([...cookies].filter(([, v]) => v).map(([name, value]) => ({ name, value, url: ctx.base })))
    return { context, page: await context.newPage() }
  }
  async function capture(page, name, width) {
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${name} fits ${width}px`)
    const path = `${name}-${width}.png`; await page.screenshot({ path: `${root}/${path}`, fullPage: false }); evidence.push(path)
  }
  for (const width of [1440, 390]) {
    const { context, page } = await pageFor(admin, width), errors = [], stockWrites = []
    page.on('pageerror', e => errors.push(e.message))
    page.on('request', r => { if (r.method() === 'POST' && new URL(r.url()).pathname === '/api/inventory/adjustments') stockWrites.push(r.postDataJSON()) })
    try {
      phase = `inventory ${width}`
      await page.goto(ctx.base + '/inventory')
      const search = page.getByRole('searchbox', { name: 'Search products, SKU or category', exact: true })
      await search.fill(product.sku)
      const pick = page.getByRole('button', { name: product.name, exact: true }); await pick.focus(); await pick.press('Enter')
      await expect(page.getByRole('heading', { name: product.name, exact: true })).toBeFocused()
      await expect(page.getByRole('heading', { name: 'Product register', exact: true })).toHaveCount(0)
      await capture(page, 'product-detail', width)
      await page.getByRole('button', { name: 'Back to products', exact: true }).click()
      await expect(page.getByRole('heading', { name: 'Product register', exact: true })).toBeFocused()
      await expect(search).toHaveValue(product.sku)
      await page.getByRole('button', { name: 'Add product', exact: true }).click()
      await expect(page.getByRole('region', { name: 'Add product', exact: true })).toBeFocused()
      await page.getByRole('button', { name: 'Back to products', exact: true }).click()
      await expect(page.getByRole('heading', { name: 'Product register', exact: true })).toBeFocused()
      await pick.click(); await page.locator('summary').filter({ hasText: /^More$/ }).click(); await page.getByRole('button', { name: 'Adjust Stock', exact: true }).click()
      await expect(page.getByRole('region', { name: 'Remove stock', exact: true })).toBeFocused()
      await page.getByRole('combobox', { name: 'Reason', exact: true }).selectOption('EXPIRED')
      await page.getByRole('spinbutton', { name: 'Quantity to remove', exact: true }).fill('2')
      await page.getByRole('textbox', { name: 'Adjustment notes', exact: true }).fill('Synthetic expiry found during stock count')
      await page.getByRole('button', { name: 'Review stock removal', exact: true }).click()
      const removal = page.getByRole('dialog', { name: 'Confirm stock removal', exact: true })
      await expect(removal).toContainText('Expired'); await expect(removal).toContainText('Use current costing order')
      await expect(removal.getByRole('button', { name: 'Cancel', exact: true })).toBeFocused()
      await capture(page, 'stock-review', width); await page.keyboard.press('Escape'); assert.equal(stockWrites.length, 0)
      await expect(page.getByRole('spinbutton', { name: 'Quantity to remove', exact: true })).toHaveValue('2')
      await page.route('**/api/inventory/adjustments', async route => { const response = await route.fetch(); assert.equal(response.status(), 201); await route.abort('failed') })
      await page.getByRole('button', { name: 'Review stock removal', exact: true }).click()
      await removal.getByRole('button', { name: 'Confirm removal', exact: true }).evaluate(button => { button.click(); button.click() })
      await expect(page.getByRole('button', { name: 'Recover original removal', exact: true })).toBeEnabled()
      assert.equal(stockWrites.length, 1)
      await page.unroute('**/api/inventory/adjustments')
      await page.getByRole('button', { name: 'Recover original removal', exact: true }).click()
      await expect(page.getByText(/The original removal is recorded once:/)).toBeVisible()
      checks.push(`${width}px inventory selection focuses detail and preserves filtered return; stock review/cancel, duplicate click and lost-response recovery use one original request`)

      phase = `administration ${width}`
      await page.goto(ctx.base + '/administration')
      const staff = page.locator('button[id^="staff-open-"]').first(), staffId = await staff.getAttribute('id')
      await staff.click()
      const selected = page.getByRole('region', { name: 'Selected employee access', exact: true })
      await expect(selected.getByRole('heading')).toBeFocused()
      await expect(page.getByRole('heading', { name: 'Staff directory', exact: true })).toHaveCount(0)
      await capture(page, 'employee-detail', width)
      await page.getByRole('button', { name: 'Cancel', exact: true }).click()
      await expect(page.locator('#' + staffId)).toBeFocused()
      await page.getByRole('button', { name: 'Manage terminal', exact: true }).first().click()
      await expect(page.getByRole('textbox', { name: 'Terminal label', exact: true })).toBeVisible()
      await page.getByRole('button', { name: 'Cancel', exact: true }).click()
      checks.push(`${width}px staff/register selection hides unrelated directories, focuses the selected workflow and restores focus on cancel`)

      phase = `student ${width}`
      await page.goto(ctx.base + '/students')
      await page.getByRole('searchbox', { name: 'Search students', exact: true }).fill('CLARITY-001')
      const studentButton = page.locator('#student-select-' + student.student_id); await studentButton.click()
      const detail = page.getByRole('dialog', { name: /Student account · Synthetic workflow student/ })
      await expect(detail).toBeVisible(); await capture(page, 'student-account', width)
      await detail.getByRole('button', { name: 'Wallet History', exact: true }).click()
      await expect(page.getByRole('dialog', { name: /Synthetic workflow student · Wallet history/ })).toBeVisible()
      await page.keyboard.press('Escape'); await expect(detail).toBeVisible()
      await detail.locator('summary').filter({ hasText: 'More student actions' }).click()
      await detail.getByRole('button', { name: 'Manage Status', exact: true }).click()
      await expect(detail.getByRole('button', { name: 'Deactivate student', exact: true })).toBeEnabled()
      await detail.getByRole('button', { name: 'Back to student account', exact: true }).click()
      await expect(detail.getByRole('region', { name: 'Student account lifecycle', exact: true })).toHaveCount(0)
      await page.keyboard.press('Escape'); await expect(studentButton).toBeFocused()
      checks.push(`${width}px student account/history/status has explicit return and preserved directory focus without a mutation`)

      phase = `POS receipt and refunds ${width}`
      await page.goto(ctx.base + '/pos')
      await page.getByRole('button', { name: new RegExp(product.name) }).filter({ has: page.locator('.product-price') }).click()
      await page.getByRole('button', { name: 'Cash', exact: true }).click()
      await page.getByRole('button', { name: /Take payment/ }).click()
      await page.getByRole('button', { name: 'Exact', exact: true }).click()
      await page.getByRole('button', { name: 'Complete Cash Payment', exact: true }).click()
      const receipt = page.getByRole('dialog', { name: 'Payment completed', exact: true })
      await expect(receipt.getByRole('button', { name: 'Start next sale', exact: true })).toBeFocused()
      const refundLink = receipt.getByRole('link', { name: 'Review refund options', exact: true })
      const reference = new URL(await refundLink.getAttribute('href'), ctx.base).searchParams.get('reference')
      await capture(page, 'payment-receipt', width); await refundLink.click()
      await expect(page.getByRole('textbox', { name: 'Receipt or online order number', exact: true })).toHaveValue(reference)
      await page.getByRole('button', { name: 'Find sale', exact: true }).click()
      await expect(page.getByRole('heading', { name: reference, exact: true })).toBeVisible()
      await page.getByRole('link', { name: /Item refunds and returns —/ }).click()
      await expect(page.getByRole('textbox', { name: 'Receipt or order reference', exact: true })).toHaveValue(reference)
      checks.push(`${width}px cash receipt links to authorized refund lookup, preserving reference across full/item modes without posting a refund`)

      phase = `reports and coupon errors ${width}`
      await page.goto(ctx.base + '/reports'); await page.getByRole('combobox', { name: 'Report', exact: true }).selectOption('inventory-report')
      await page.getByRole('button', { name: 'Open report', exact: true }).click()
      await expect(page.locator('.report-section')).toHaveCount(1); await expect(page.getByRole('heading', { name: 'Inventory value', exact: true })).toBeVisible(); await capture(page, 'report-choice', width)
      await page.route('**/api/coupons', route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ ok: false, error: { code: 'INTERNAL_ERROR', message: 'Synthetic coupon directory unavailable' } }) }), { times: 1 })
      await page.goto(ctx.base + '/coupons'); await expect(page.getByRole('button', { name: 'Retry coupon directory', exact: true })).toBeVisible()
      await page.getByRole('button', { name: 'Retry coupon directory', exact: true }).click()
      await expect(page.getByRole('button', { name: 'Retry coupon directory', exact: true })).toHaveCount(0)
      await expect(page.getByRole('textbox', { name: 'Coupon name', exact: true })).not.toBeVisible()
      await page.locator('summary').filter({ hasText: 'Create a coupon' }).click()
      await page.getByRole('textbox', { name: 'Coupon name', exact: true }).fill('Synthetic preserved draft')
      await page.locator('summary').filter({ hasText: 'Create a coupon' }).click(); await page.locator('summary').filter({ hasText: 'Create a coupon' }).click()
      await expect(page.getByRole('textbox', { name: 'Coupon name', exact: true })).toHaveValue('Synthetic preserved draft')
      await capture(page, 'coupon-actions', width)
      checks.push(`${width}px reports show one chosen panel; coupon directory exposes retry and deliberate creation without losing collapsed drafts`)
      assert.deepEqual(errors, [])
    } finally { await context.close() }
    const shop = await pageFor(customer, width)
    try {
      phase = `customer routes ${width}`
      for (const [path, heading] of [['/store', 'Your school day, delivered.'], ['/store/orders', 'My orders'], ['/store/account', 'My account']]) {
        await shop.page.goto(ctx.base + path); await expect(shop.page.getByRole('heading', { name: heading, exact: true })).toBeVisible()
        await capture(shop.page, path.replaceAll('/', '-'), width)
      }
      checks.push(`${width}px authenticated customer shop/orders/account each have a usable purpose, navigation and no document overflow`)
    } finally { await shop.context.close() }
  }
  await fs.writeFile(`${root}/results.json`, JSON.stringify({ result: 'PASS', checks, evidence }, null, 2))
  console.log(JSON.stringify({ result: 'PASS', checks, evidence }, null, 2))
} catch (error) {
  await fs.writeFile(`${root}/results.json`, JSON.stringify({ result: 'FAIL', phase, error: String(error), checks, evidence }, null, 2)); throw error
} finally { await browser?.close(); await ctx?.close() }
