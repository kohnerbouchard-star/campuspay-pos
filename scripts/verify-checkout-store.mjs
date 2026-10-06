#!/usr/bin/env node
// Checkout-owned acceptance. Existing harness/test files are read, never modified.
// All data is synthetic in a CI-only, randomly named localhost PostgreSQL database.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { randomBytes, randomUUID } from 'node:crypto'
import { chromium, expect } from '@playwright/test'
import { refundTestContext } from './refund-test-context.mjs'
const directory = '.validation/checkout-store', checks = [], evidence = [], pages = [], contexts = []
fs.mkdirSync(directory, { recursive: true })
let ctx, browser, phase = 'setup'
const won = n => new Intl.NumberFormat('ko-KR', { style: 'currency', currency: 'KRW', maximumFractionDigits: 0 }).format(n)
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r }); return { promise, resolve } }
try {
  ctx = await refundTestContext()
  assert.match((await ctx.owner.query('select current_database() name')).rows[0].name, /^campuspay_refund_[a-f0-9]{12}$/)
  await ctx.start(false)
  const { owner, request, pin, base } = ctx, admin = await ctx.login()
  const catalog = await request(admin, '/api/pos/catalog'), water = catalog.find(p => p.sku === 'WATER-001'), other = catalog.find(p => !p.sold_out && p.sku !== 'WATER-001')
  assert.ok(water && other)
  // Dedicated stock receipt keeps cap tests independent of bootstrap stock size.
  await request(admin, '/api/inventory/receipts', { supplierName: 'Synthetic checkout fixture', supplierInvoice: randomUUID(), purchaseDate: '2026-10-07', shippingWon: 0, otherCostsWon: 0, discountWon: 0, notes: 'Isolated checkout fixture only', lines: [{ productId: water.id, quantity: 200, purchaseUnitCostWon: 500, expirationDate: null }], idempotencyKey: randomUUID() }, 201)
  for (const [code, rate] of [['CHECKOUTA', 1000], ['CHECKOUTB', 2000]]) {
    await request(admin, '/api/coupons', { name: `Synthetic ${code}`, code, discountType: 'PERCENTAGE', fixedAmountWon: null, percentageBps: rate, minimumSubtotalWon: 0, maxDiscountWon: null, totalRedemptionLimit: null, perStudentLimit: null, startsAt: new Date(Date.now() - 60000).toISOString(), endsAt: null, idempotencyKey: randomUUID() }, 201)
  }
  const enroll = async label => {
    const card = `CHECKOUT${randomBytes(12).toString('hex')}`, code = `CHK-${randomUUID().slice(0, 8)}`
    await request(admin, '/api/students', { studentCode: code, displayName: `Synthetic ${label}`, cardRead: card, pin, confirmationPin: pin, idempotencyKey: randomUUID() }, 201)
    const id = (await owner.query('select id from private.students where student_code=$1', [code])).rows[0].id
    return { id, card }
  }
  const posStudent = await enroll('checkout receipt'), storeStudent = await enroll('store recovery')
  const customer = new Map(); await request(customer, '/api/store/login', { cardNumber: storeStudent.card, pin })
  const locations = await request(customer, '/api/store/locations'), location = locations.find(l => l.orderable && l.room === '201')
  assert.ok(location)
  browser = await chromium.launch({ headless: true })
  const pageErrors = []
  async function makePage(cookies, width = 1440) {
    const context = await browser.newContext({ viewport: { width, height: 1000 } }); contexts.push(context)
    await context.addCookies([...cookies].filter(([, v]) => v).map(([name, value]) => ({ name, value, url: base })))
    const page = await context.newPage(); pages.push(page)
    // Install before navigation so application intervals and deadlines share one clock.
    await page.clock.install()
    page.on('pageerror', error => pageErrors.push(error.message))
    return page
  }
  async function capture(page, name) {
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 900 })
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${name}: no horizontal document clipping at ${width}`)
      const filename = `${name}-${width}.png`; await page.screenshot({ path: `${directory}/${filename}`, fullPage: false }); evidence.push(filename)
    }
  }
  const pos = await makePage(admin)
  const add = name => pos.getByRole('button', { name: new RegExp(name) }).filter({ has: pos.locator('.product-price') })
  const take = () => pos.getByRole('button', { name: /Take payment|Check or clear coupon before payment/ })
  async function resetPos() { await pos.goto(base + '/pos'); await add(water.name).click() }
  const holds = []
  await pos.route('**/api/pos/coupons/quote', async route => {
    const response = await route.fetch(); assert.equal(response.status(), 200)
    const hold = { ...deferred(), body: await response.json() }; holds.push(hold)
    await hold.promise; await route.fulfill({ response })
  })
  async function beginCoupon(code = 'CHECKOUTA') {
    const count = holds.length
    await pos.getByLabel('Coupon code', { exact: true }).fill(code)
    await pos.getByLabel('Coupon code', { exact: true }).press('Enter')
    await expect.poll(() => holds.length).toBe(count + 1)
    await expect(take()).toBeDisabled()
    return holds.at(-1)
  }
  for (const kind of ['quantity', 'add', 'remove']) {
    phase = `delayed coupon / ${kind}`; await resetPos()
    if (kind === 'remove') await add(other.name).click()
    const hold = await beginCoupon()
    if (kind === 'quantity') await pos.getByRole('button', { name: `Increase ${water.name} quantity`, exact: true }).click()
    else if (kind === 'add') await add(other.name).click()
    else await pos.getByRole('button', { name: `Decrease ${water.name} quantity`, exact: true }).click()
    hold.resolve(); await expect(pos.locator('.coupon-entry')).toHaveAttribute('aria-busy', 'false')
    await expect(pos.locator('.coupon-applied')).toHaveCount(0)
    const total = kind === 'quantity' ? water.selling_price_won * 2 : kind === 'add' ? water.selling_price_won + other.selling_price_won : other.selling_price_won
    await expect(take()).toContainText(won(total)); await expect(take()).toBeEnabled()
    checks.push(`Delayed coupon rejected after ${kind}; new cart total preserved`)
  }
  phase = 'coupon replacement and clear'
  await resetPos(); const first = await beginCoupon(), second = await beginCoupon('CHECKOUTB')
  first.resolve(); await expect(take()).toBeDisabled()
  second.resolve(); await expect(pos.locator('.coupon-applied')).toContainText('Synthetic CHECKOUTB')
  await expect(take()).toContainText(won(second.body.data.total_won))
  await capture(pos, 'coupon-replaced')
  await pos.getByRole('button', { name: 'Remove Synthetic CHECKOUTB coupon', exact: true }).press('Enter')
  await expect(pos.getByLabel('Coupon code', { exact: true })).toBeFocused()
  const cleared = await beginCoupon(); await pos.getByRole('button', { name: 'Clear coupon', exact: true }).press('Enter'); cleared.resolve()
  await expect(pos.locator('.coupon-applied')).toHaveCount(0); await expect(take()).toContainText(won(water.selling_price_won))
  // Let the current response finish FIRST; an older response cannot overwrite it.
  const older = await beginCoupon(), newer = await beginCoupon('CHECKOUTB'); newer.resolve()
  await expect(pos.locator('.coupon-applied')).toContainText('Synthetic CHECKOUTB'); older.resolve()
  await expect(pos.locator('.coupon-applied')).toContainText('Synthetic CHECKOUTB')
  checks.push('Replacement, clearing, reversed completion order and keyboard/focus return reject stale coupon responses')
  await pos.unroute('**/api/pos/coupons/quote')

  phase = 'quantity controls and stock refresh'; await resetPos()
  const quantity = pos.getByRole('spinbutton', { name: `${water.name} quantity`, exact: true }), increment = pos.getByRole('button', { name: `Increase ${water.name} quantity`, exact: true })
  for (const width of [1440, 390]) {
    await pos.setViewportSize({ width, height: 900 })
    for (const [typed, expected] of [['98','98'], ['100','99'], ['10000','99'], ['1.9','1']]) { await quantity.fill(typed); await quantity.press('Enter'); await expect(quantity).toHaveValue(expected) }
    await quantity.fill('7'); await quantity.press('Escape'); await expect(quantity).toHaveValue('1')
    await quantity.fill('100'); await quantity.press('Tab'); await expect(quantity).toHaveValue('99')
    await quantity.fill('95'); await quantity.press('Enter')
    for (let i = 0; i < 4; i++) await increment.press('Enter')
    await expect(quantity).toHaveValue('99'); await expect(increment).toBeDisabled()
  }
  await capture(pos, 'quantity-limit')
  await pos.route('**/api/pos/payment-policy', route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ ok: false, error: { code: 'INTERNAL_ERROR', message: 'Synthetic refresh check' } }) }), { times: 1 })
  await pos.clock.fastForward(15_001)
  await expect(pos.getByRole('button', { name: 'Try again', exact: true })).toBeVisible()
  await pos.route('**/api/pos/catalog', async route => {
    const response = await route.fetch(), body = await response.json()
    body.data = body.data.map(p => p.id === water.id ? { ...p, stock_on_hand: 3 } : p)
    await route.fulfill({ response, json: body })
  }, { times: 1 })
  await pos.getByRole('button', { name: 'Try again', exact: true }).click()
  await expect(quantity).toHaveValue('3'); await expect(quantity).toHaveAttribute('max', '3'); await expect(increment).toBeDisabled()
  await quantity.fill('0'); await quantity.press('Enter'); await expect(quantity).toHaveCount(0)
  await pos.clock.resume()
  checks.push('Desktop/mobile numeric entry, Enter, 98/99 boundary, disabled increment, stock refresh to 3 and zero removal')

  async function nativeReceipt(id) {
    const receipt = (await owner.query('select * from private.sales where id=$1', [id])).rows[0]
    const items = (await owner.query('select product_name_snapshot name, quantity, line_total_won from private.sale_items where sale_id=$1 order by id', [id])).rows
    assert.equal(items.reduce((sum, item) => sum + Number(item.line_total_won), 0), Number(receipt.subtotal_won))
    return { receipt, items }
  }
  async function assertReceiptUI(page, id) {
    const { receipt, items } = await nativeReceipt(id)
    const dialog = page.getByRole('dialog', { name: 'Payment completed', exact: true }); await expect(dialog).toBeVisible()
    for (const item of items) await expect(dialog.locator('.tender-summary > div').filter({ hasText: `${item.name} × ${item.quantity}` }).locator('dd')).toHaveText(won(Number(item.line_total_won)))
    await expect(dialog.locator('.total-row dd')).toHaveText(won(Number(receipt.total_won)))
    if (Number(receipt.discount_won)) await expect(dialog.locator('.tender-summary > div').filter({ hasText: 'Synthetic CHECKOUTA' }).locator('dd')).toHaveText(`−${won(Number(receipt.discount_won))}`)
    return receipt
  }
  let confirmPosts = 0; pos.on('request', req => { if (/\/api\/pos\/intents\/[^/]+\/confirm$/.test(new URL(req.url()).pathname)) confirmPosts++ })
  for (const [kind, price] of [['normal',1234], ['response-loss',1299], ['receipt-read-loss',1301]]) {
    phase = `authoritative receipt / ${kind}`; await resetPos()
    await pos.getByRole('button', { name: `Increase ${water.name} quantity`, exact: true }).click()
    await pos.getByLabel('Coupon code', { exact: true }).fill('CHECKOUTA'); await pos.getByLabel('Coupon code', { exact: true }).press('Enter')
    await expect(pos.locator('.coupon-applied')).toBeVisible()
    const currentProduct = (await request(admin, `/api/management?kind=PRODUCT&status=ALL&targetId=${water.id}`)).records[0]
    assert.ok(currentProduct)
    const changedPrice = await request(admin, '/api/management', { kind: 'PRODUCT', action: 'CHANGE_PRODUCT_PRICE', targetId: water.id,
      expectedUpdatedAt: currentProduct.updated_at, sellingPriceWon: price, reason: 'Synthetic price changed after register catalog/quote load',
      verified: true, requestKey: randomUUID() })
    assert.equal(changedPrice.outcome, 'COMPLETED')
    let approval, intentId
    await pos.route('**/api/pos/intents/*/confirm', async route => {
      intentId = new URL(route.request().url()).pathname.split('/')[4]
      const response = await route.fetch(); assert.equal(response.status(), 200); approval = (await response.json()).data
      if (kind === 'response-loss') await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ ok: false, error: { code: 'INTERNAL_ERROR', message: 'Synthetic committed response loss' } }) })
      else await route.fulfill({ response })
    }, { times: 1 })
    if (kind === 'receipt-read-loss') await pos.route('**/api/pos/intents/*/recover', route => route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ ok: false, error: { code: 'UNAUTHENTICATED', message: 'Synthetic read failed after approval' } }) }), { times: 1 })
    const previousPosts = confirmPosts
    await take().click(); await expect(pos.getByRole('dialog', { name: 'Scan MICA Money Card', exact: true })).toBeVisible()
    await pos.keyboard.type(posStudent.card, { delay: 8 }); await pos.keyboard.press('Enter')
    await pos.getByLabel('Student PIN', { exact: true }).fill(pin); await pos.getByRole('button', { name: 'Pay with MICA Money', exact: true }).press('Enter')
    if (kind === 'response-loss') {
      await expect(pos.getByText('Payment result unknown', { exact: true })).toBeVisible()
      assert.equal(await pos.evaluate(() => sessionStorage.getItem('campuspay.pendingPayment')), intentId)
      await pos.reload()
    } else if (kind === 'receipt-read-loss') {
      await expect(pos.getByText('Payment approved · receipt details pending', { exact: true })).toBeVisible()
      assert.equal(await pos.evaluate(() => sessionStorage.getItem('campuspay.pendingPayment')), intentId)
      await expect(pos.getByRole('button', { name: 'Recover payment result above', exact: true })).toBeDisabled()
      await capture(pos, 'receipt-details-pending')
      await pos.getByRole('button', { name: 'Recover payment result', exact: true }).press('Enter')
    }
    await expect.poll(() => !!approval).toBe(true)
    const sale = await assertReceiptUI(pos, approval.sale_id)
    assert.equal(Number(sale.subtotal_won), price * 2)
    assert.equal(confirmPosts, previousPosts + 1)
    assert.equal(await pos.evaluate(() => sessionStorage.getItem('campuspay.pendingPayment')), null)
    const count = (await owner.query('select count(*)::int n from private.sales where payment_intent_id=$1', [intentId])).rows[0].n
    assert.equal(count, 1)
    await capture(pos, `receipt-${kind}`)
    const dialog = pos.getByRole('dialog', { name: 'Payment completed', exact: true })
    for (let i = 0; i < 5; i++) { await pos.keyboard.press('Tab'); assert.ok(await pos.evaluate(() => !!document.activeElement?.closest('dialog'))) }
    await pos.keyboard.press('Escape'); await expect(dialog).toHaveCount(0)
    checks.push(`Price changed after catalog/quote load: ${kind} prints exact sale snapshots, preserves discount/rounding, one confirmation/sale; modal keyboard behavior`)
  }

  const store = await makePage(customer, 390), storageKey = `mica-money:pending-order:${storeStudent.id}`
  const native = async () => (await owner.query(`select
    (select count(*)::int from private.online_orders where student_id=$1) orders,
    (select count(*)::int from private.sales where student_id=$1) sales,
    (select count(*)::int from private.wallet_ledger where student_id=$1) ledger,
    (select balance_won::bigint from private.wallets where student_id=$1)::text balance,
    (select sum(quantity_remaining)::bigint from private.inventory_lots where product_id=$2)::text stock`, [storeStudent.id, water.id])).rows[0]
  const saved = async () => store.evaluate(key => JSON.parse(sessionStorage.getItem(key)), storageKey)
  async function reviewStore() {
    await store.goto(base + '/store'); await store.getByRole('button', { name: `Add ${water.name} to cart`, exact: true }).click()
    await store.getByLabel('Room', { exact: true }).selectOption(location.location_id)
    await store.getByRole('button', { name: 'Review order', exact: true }).press('Enter')
    await expect(store.getByRole('button', { name: /^Place order/ })).toBeVisible()
  }
  let placePosts = 0; const recoveryKeys = []
  store.on('request', req => {
    const path = new URL(req.url()).pathname
    if (path === '/api/store/orders' && req.method() === 'POST') placePosts++
    if (path === '/api/store/orders/recover') recoveryKeys.push(req.postDataJSON().idempotencyKey)
  })
  async function timeoutUnknown() {
    await store.clock.fastForward(30_001)
    await expect(store.locator('section[aria-label="Order recovery"]')).toBeFocused()
    await expect(store.getByRole('button', { name: 'Recover order', exact: true })).toBeEnabled()
    await expect(store.getByRole('button', { name: /^Place order/ })).toHaveCount(0)
  }
  phase = 'stalled original request, tombstone and late arrival'; await reviewStore()
  const beforeAbsent = await native(), absentGate = deferred(); let absentInput
  await store.route('**/api/store/orders', async route => {
    if (route.request().method() !== 'POST') return route.continue()
    absentInput = route.request().postDataJSON(); await absentGate.promise
    await route.abort().catch(() => undefined)
  }, { times: 1 })
  await store.getByRole('button', { name: /^Place order/ }).press('Enter'); await expect.poll(() => !!absentInput).toBe(true)
  await timeoutUnknown(); assert.equal((await saved()).idempotencyKey, absentInput.idempotencyKey)
  await capture(store, 'store-result-unknown')
  await store.getByRole('button', { name: 'Recover order', exact: true }).press('Enter')
  await expect(store.locator('section[aria-label="Order recovery"]')).toHaveCount(0)
  assert.equal(await saved(), null); assert.deepEqual(await native(), beforeAbsent)
  // A late arrival of the ORIGINAL request is rejected by the existing DB fence.
  await request(customer, '/api/store/orders', absentInput, 409); absentGate.resolve()
  assert.deepEqual(await native(), beforeAbsent)
  checks.push('Stalled pre-commit request times out, retains key, keyboard recovery closes it; late original arrival cannot charge after tombstone')

  phase = 'committed response lost, stalled recovery, reload, repeated recovery and late responses'
  await store.clock.resume(); await reviewStore()
  const beforeCommitted = await native(), placementGate = deferred(), recoveryGate = deferred()
  let submitted, committed, firstRecovery
  const previousPlaces = placePosts
  await store.route('**/api/store/orders', async route => {
    if (route.request().method() !== 'POST') return route.continue()
    submitted = route.request().postDataJSON()
    const response = await route.fetch(); assert.equal(response.status(), 201); committed = (await response.json()).data
    await placementGate.promise; await route.fulfill({ response }).catch(() => undefined)
  }, { times: 1 })
  await store.getByRole('button', { name: /^Place order/ }).press('Enter'); await expect.poll(() => !!committed).toBe(true)
  await timeoutUnknown()
  const pending = await saved(); assert.deepEqual(Object.keys(pending).sort(), ['idempotencyKey','studentId','version'])
  assert.equal(pending.idempotencyKey, submitted.idempotencyKey)
  await store.route('**/api/store/orders/recover', async route => {
    const response = await route.fetch(); assert.equal(response.status(), 200); firstRecovery = (await response.json()).data
    await recoveryGate.promise; await route.fulfill({ response }).catch(() => undefined)
  }, { times: 1 })
  await store.getByRole('button', { name: 'Recover order', exact: true }).press('Enter'); await expect.poll(() => !!firstRecovery).toBe(true)
  await timeoutUnknown(); assert.equal((await saved()).idempotencyKey, submitted.idempotencyKey)
  await store.reload()
  await expect(store.getByRole('button', { name: 'Recover order', exact: true })).toBeEnabled()
  assert.equal((await saved()).idempotencyKey, submitted.idempotencyKey)
  await store.getByRole('button', { name: 'Recover order', exact: true }).press('Enter')
  await expect(store.getByRole('heading', { name: committed.order_number, exact: true })).toBeVisible()
  assert.equal(await saved(), null); placementGate.resolve(); recoveryGate.resolve()
  await expect(store.getByRole('heading', { name: committed.order_number, exact: true })).toBeVisible()
  for (let i = 0; i < 3; i++) assert.equal((await request(customer, '/api/store/orders/recover', { idempotencyKey: submitted.idempotencyKey })).order_id, committed.order_id)
  assert.equal((await request(customer, '/api/store/orders', submitted, 201)).order_id, committed.order_id)
  const after = await native()
  assert.equal(after.orders, beforeCommitted.orders + 1); assert.equal(after.sales, beforeCommitted.sales + 1); assert.equal(after.ledger, beforeCommitted.ledger + 1)
  assert.equal(Number(after.balance), Number(beforeCommitted.balance) - committed.total_won); assert.equal(Number(after.stock), Number(beforeCommitted.stock) - 1)
  assert.equal(placePosts, previousPlaces + 1)
  assert.ok(recoveryKeys.slice(-2).every(key => key === submitted.idempotencyKey))
  const unique = (await owner.query('select count(*)::int n, count(distinct sale_id)::int sales from private.online_orders where idempotency_key=$1', [submitted.idempotencyKey])).rows[0]
  assert.deepEqual(unique, { n: 1, sales: 1 })
  await capture(store, 'store-recovered')
  checks.push('Real committed/lost response + timed-out recovery + reload + late responses: one browser placement, one order/sale/ledger debit/stock unit; same UUID throughout')
  // Independently exercise actual server serialization, not just response mocks.
  phase = 'native concurrent same-key order/recovery serialization'
  const raced = { ...submitted, idempotencyKey: randomUUID() }, beforeRace = await native()
  const replies = await Promise.all([request(customer, '/api/store/orders', raced, 201), request(customer, '/api/store/orders', raced, 201)])
  assert.equal(replies[0].order_id, replies[1].order_id)
  const recovered = await Promise.all(Array.from({ length: 4 }, () => request(customer, '/api/store/orders/recover', { idempotencyKey: raced.idempotencyKey })))
  assert.ok(recovered.every(r => r.order_id === replies[0].order_id))
  const afterRace = await native()
  assert.equal(afterRace.orders, beforeRace.orders + 1); assert.equal(afterRace.sales, beforeRace.sales + 1); assert.equal(afterRace.ledger, beforeRace.ledger + 1)
  assert.equal(Number(afterRace.balance), Number(beforeRace.balance) - replies[0].total_won)
  checks.push('Native simultaneous same-key placement and repeated recovery serialize to one order and one charge')
  assert.deepEqual(pageErrors, [])
  fs.writeFileSync(`${directory}/results.json`, JSON.stringify({ passed: true, liveDataUsed: false, checks, screenshots: evidence, native: { beforeCommitted, after, beforeRace, afterRace }, pageErrors }, null, 2))
  console.log(JSON.stringify({ checks, native: { beforeCommitted, after, beforeRace, afterRace }, pageErrors }))
  console.log(`PASS: checkout/store acceptance (${checks.length} groups; ${evidence.length} desktop/mobile screenshots)`)
} catch (error) {
  fs.writeFileSync(`${directory}/failure.txt`, `Phase: ${phase}\n${error.stack}`)
  const last = pages.filter(p => !p.isClosed()).at(-1); if (last) await last.screenshot({ path: `${directory}/failure.png` }).catch(() => undefined)
  console.error(`FAIL checkout/store at ${phase}: ${error.stack}`)
  console.error(JSON.stringify({ completedChecks: checks, screenshotsGenerated: evidence }))
  process.exitCode = 1
} finally {
  await Promise.allSettled(contexts.map(c => c.close()))
  if (browser) await browser.close()
  if (ctx) await ctx.close()
}
