// Standalone browser verification for the isolated HTTP integration harness.
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { chromium } from '@playwright/test'
import { verifyCatalogServiceRecovery } from './catalog-service-recovery.mjs'

const viewports = [
  { width: 1440, height: 1000 }, { width: 1024, height: 900 },
  { width: 768, height: 1024 }, { width: 390, height: 844 },
]

export async function runVisualQa({ base, login, request, jar, owner }) {
  assert.ok(['127.0.0.1', 'localhost'].includes(new URL(base).hostname), 'Visual QA requires a localhost server')
  assert.ok(['127.0.0.1', 'localhost'].includes(owner.connectionParameters.host), 'Visual QA requires an isolated localhost database')
  const directory = path.resolve('.validation/visual')
  fs.mkdirSync(directory, { recursive: true })
  const browser = await chromium.launch({ headless: true })
  const screenshots = []
  const findings = []
  const pageErrors = []
  const consoleErrors = []
  const expectedConsoleErrors = []
  const expectedHttpErrors = new WeakMap()
  const contexts = []
  let lastPage
  const suffix = randomBytes(5).toString('hex').toUpperCase()
  const visualCard = `VISUAL${suffix}`
  const visualPin = '792648'
  let currentPin = visualPin
  let visualStudentId
  let visualOrderId
  let visualOrderNumber
  const studentName = `Visual QA ${suffix}`
  const studentCode = `VISUAL-${suffix}`

  async function pageFor(cookies = jar()) {
    const context = await browser.newContext({ viewport: viewports[0], reducedMotion: 'reduce' })
    contexts.push(context)
    await context.addCookies([...cookies].filter(([, value]) => value).map(([name, value]) => ({ name, value, url: base })))
    const page = await context.newPage()
    await page.clock.install()
    lastPage = page
    page.setDefaultTimeout(12000)
    page.on('pageerror', (error) => pageErrors.push({ url: page.url(), message: error.message }))
    page.on('console', (entry) => {
      if (entry.type() !== 'error') return
      const record = { url: page.url(), resource: entry.location().url, message: entry.text() }
      const expected = (expectedHttpErrors.get(page) ?? []).some((failure) =>
        record.resource === failure.url && record.message.includes(String(failure.status)) && /Failed to load resource/i.test(record.message))
      if (expected) expectedConsoleErrors.push(record)
      else consoleErrors.push(record)
    })
    return page
  }

  async function settled(page) {
    await page.waitForLoadState('networkidle')
    await page.waitForFunction(() => !document.querySelector('[data-nextjs-dialog], .vite-error-overlay'))
  }

  async function capture(page, name, viewport, { waitForNetwork = true, ready } = {}) {
    await page.setViewportSize(viewport)
    await page.evaluate(() => window.scrollTo(0, 0))
    // Trusted activity preserves the real short cashier timeout while reviewing responsive states.
    if (!['pos-timeout-warning', 'staff-timeout-warning'].includes(name)) await page.keyboard.press('Shift')
    if (ready) await ready()
    else if (waitForNetwork) await settled(page)
    if (name === 'reports' && viewport.width === 390) {
      const register = page.getByRole('region', { name: 'Transaction register', exact: true })
      const firstReceipt = register.locator('tbody tr').first().locator('td').first()
      await register.scrollIntoViewIfNeeded()
      await register.evaluate((element) => { element.scrollLeft = 0 })
      await firstReceipt.scrollIntoViewIfNeeded()
      await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))))
      assert.equal(await firstReceipt.isVisible(), true, 'Mobile transaction register contains a visible receipt cell')
      const receiptInViewport = await firstReceipt.evaluate((element) => {
        const bounds = element.getBoundingClientRect()
        return bounds.top >= 0 && bounds.bottom <= innerHeight && bounds.right > 0 && bounds.left < innerWidth
      })
      assert.equal(receiptInViewport, true, 'First mobile receipt is inside the viewport')
      const registerFilename = 'reports-register-390.png'
      await page.screenshot({ path: path.join(directory, registerFilename), fullPage: false, animations: 'disabled' })
      screenshots.push({ name: 'reports-register', viewport, file: `.validation/visual/${registerFilename}`, url: page.url(), capture: 'viewport', firstReceiptInViewport: receiptInViewport })
      await page.evaluate(() => window.scrollTo(0, 0))
      await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))))
    }
    if (name === 'pos-payment-result-unknown') {
      const warning = page.getByRole('alert').filter({ hasText: 'Payment result unknown' })
      await warning.scrollIntoViewIfNeeded()
      assert.equal(await warning.evaluate(element => { const bounds = element.getBoundingClientRect(); return bounds.top >= 0 && bounds.bottom <= innerHeight }), true, 'Unknown result and recovery action are visible in the dialog viewport')
    }
    const filename = `${name}-${viewport.width}.png`
    await page.screenshot({ path: path.join(directory, filename), fullPage: true, animations: 'disabled' })
    const metrics = await page.evaluate(() => ({
      width: innerWidth,
      scrollWidth: document.documentElement.scrollWidth,
      content: document.body.innerText.trim().length,
      unlabeledFields: [...document.querySelectorAll('input,select,textarea')].filter((element) => {
        if (!element.getClientRects().length || element.type === 'hidden') return false
        return !element.getAttribute('aria-label') && !element.getAttribute('aria-labelledby') && !element.labels?.length
      }).map((element) => ({ tag: element.tagName, name: element.name, placeholder: element.getAttribute('placeholder') })),
      unnamedButtons: [...document.querySelectorAll('button')].filter((element) => element.getClientRects().length
        && !element.textContent.trim() && !element.getAttribute('aria-label') && !element.getAttribute('aria-labelledby') && !element.title).length,
    }))
    screenshots.push({ name, viewport, file: `.validation/visual/${filename}`, url: page.url(), ...metrics })
    if (metrics.scrollWidth > metrics.width + 1) findings.push(`${filename}: document overflows by ${metrics.scrollWidth - metrics.width}px`)
    if (!metrics.content) findings.push(`${filename}: page is blank`)
    if (metrics.unlabeledFields.length) findings.push(`${filename}: unlabeled form fields ${JSON.stringify(metrics.unlabeledFields)}`)
    if (metrics.unnamedButtons) findings.push(`${filename}: ${metrics.unnamedButtons} buttons have no accessible name`)
  }

  async function captureAll(page, name, options) {
    for (const viewport of viewports) await capture(page, name, viewport, options)
    await page.setViewportSize(viewports[0])
  }

  async function assertDialogFocus(page) {
    const dialog = page.getByRole('dialog')
    await dialog.waitFor({ state: 'visible' })
    for (const key of ['Tab', 'Shift+Tab']) {
      for (let i = 0; i < 8; i++) {
        await page.keyboard.press(key)
        assert.equal(await dialog.evaluate((element) => element === document.activeElement || element.contains(document.activeElement)), true, `Native dialog must keep keyboard focus inside during ${key}`)
      }
    }
  }

  try {
    const anonymous = await pageFor()
    await anonymous.goto(`${base}/login`)
    await anonymous.getByRole('heading', { name: 'Staff sign in' }).waitFor()
    await captureAll(anonymous, 'staff-login')
    await anonymous.goto(`${base}/store/login`)
    await anonymous.getByRole('heading', { name: 'Sign in to MICA Store' }).waitFor()
    await captureAll(anonymous, 'student-login')
    await anonymous.getByText('How to get a MICA Money Card', { exact: true }).click()
    await capture(anonymous, 'student-e202-help', viewports[3])
    expectedHttpErrors.set(anonymous, [{ url: `${base}/api/store/login`, status: 401 }])
    await anonymous.getByLabel('Card number', { exact: true }).fill(`UNKNOWN${suffix}`)
    await anonymous.getByLabel('PIN', { exact: true }).fill('000000')
    await anonymous.getByRole('button', { name: 'Sign in', exact: true }).click()
    await anonymous.getByRole('alert').filter({ hasText: 'We couldn’t verify those MICA Money credentials.' }).waitFor()
    assert.equal(await anonymous.getByLabel('PIN', { exact: true }).inputValue(), '', 'Rejected sign-in clears the PIN')
    await captureAll(anonymous, 'student-login-error')

    // Actual Super Admin enrollment through the reader and PIN form.
    const adminCookies = await login('9001')
    const adminPage = await pageFor(adminCookies)
    await adminPage.goto(`${base}/students`)
    await adminPage.getByRole('heading', { name: 'Students', exact: true }).waitFor()
    await captureAll(adminPage, 'students')
    await adminPage.getByRole('button', { name: '+ Enroll student', exact: true }).click()
    await adminPage.getByLabel('Student ID', { exact: true }).fill(studentCode)
    await adminPage.getByLabel('Student name', { exact: true }).fill(studentName)
    await adminPage.getByRole('button', { name: 'Scan MICA Money Card', exact: true }).click()
    await capture(adminPage, 'enrollment-reader', viewports[0])
    await adminPage.keyboard.type(visualCard, { delay: 8 })
    await adminPage.keyboard.press('Enter')
    await adminPage.getByText('Card detected. Ready to activate.', { exact: true }).waitFor()
    await adminPage.getByLabel('Student PIN', { exact: true }).fill(visualPin)
    assert.equal(await adminPage.getByRole('button', { name: 'Create MICA Money account', exact: true }).isDisabled(), true, 'Missing PIN confirmation prevents enrollment')
    assert.equal(await adminPage.getByLabel('Confirm student PIN', { exact: true }).evaluate((input) => input.checkValidity()), false, 'Browser requires PIN confirmation')
    await captureAll(adminPage, 'enrollment-confirmation-required')
    await adminPage.getByLabel('Confirm student PIN', { exact: true }).fill(visualPin)
    await adminPage.clock.fastForward(180000)
    assert.ok(adminPage.url().includes('/students'), 'Enrollment remains usable after three minutes')
    await captureAll(adminPage, 'enrollment-ready')
    const enrollmentResponse = adminPage.waitForResponse((response) => response.url().endsWith('/api/students') && response.request().method() === 'POST')
    await adminPage.getByRole('button', { name: 'Create MICA Money account', exact: true }).click()
    const enrollment = await (await enrollmentResponse).json()
    assert.equal(enrollment.ok, true)
    visualStudentId = enrollment.data.student_id
    await adminPage.getByRole('heading', { name: 'MICA Money account created', exact: true }).waitFor()
    await captureAll(adminPage, 'enrollment-success')

    await adminPage.clock.setSystemTime(new Date())
    await adminPage.goto(`${base}/security?studentId=${visualStudentId}`)
    await adminPage.getByRole('heading', { name: 'Security', exact: true }).waitFor()
    await captureAll(adminPage, 'security')
    await adminPage.getByLabel('Approving employee ID', { exact: true }).fill('9002')
    await adminPage.getByLabel('Approving employee PIN', { exact: true }).fill('12345678')
    await adminPage.getByRole('button', { name: 'Authorize protected action', exact: true }).click()
    await adminPage.getByLabel('Student enters new PIN', { exact: true }).fill('739264')
    await adminPage.getByLabel('Student confirms new PIN', { exact: true }).fill('739264')
    await captureAll(adminPage, 'security-pin-reset')
    await adminPage.getByRole('button', { name: 'Complete PIN reset', exact: true }).click()
    await adminPage.getByText(/Student PIN reset\. Receipt:/).waitFor()
    currentPin = '739264'
    await adminPage.getByRole('button', { name: 'Replace card', exact: true }).click()
    await adminPage.getByLabel('Approving employee PIN', { exact: true }).fill('12345678')
    await adminPage.getByRole('button', { name: 'Authorize protected action', exact: true }).click()
    await adminPage.getByRole('button', { name: 'Scan replacement card', exact: true }).click()
    await adminPage.keyboard.type(`REPLACEMENT${suffix}`, { delay: 8 })
    await adminPage.keyboard.press('Enter')
    await adminPage.getByText('Replacement card detected. Review the student before confirming.', { exact: true }).waitFor()
    await captureAll(adminPage, 'security-card-replacement')
    await adminPage.getByRole('button', { name: 'Cancel', exact: true }).click()
    await adminPage.context().close()

    // UI authentication preserves the protected order-history destination.
    const customerPage = await pageFor()
    await customerPage.goto(`${base}/store/orders`)
    await customerPage.getByRole('heading', { name: 'Sign in to MICA Store' }).waitFor()
    assert.match(customerPage.url(), /next=%2Fstore%2Forders/)
    await customerPage.getByLabel('Card number', { exact: true }).fill(visualCard)
    await customerPage.getByLabel('PIN', { exact: true }).fill(currentPin)
    await customerPage.getByRole('button', { name: 'Sign in', exact: true }).click()
    await customerPage.waitForURL(`${base}/store/orders`)
    await customerPage.getByRole('heading', { name: 'My orders', exact: true }).waitFor()
    await captureAll(customerPage, 'student-empty-orders')

    // Hold only the local catalog request so the actual loading UI stays visible.
    let releaseCatalog
    const catalogGate = new Promise((resolve) => { releaseCatalog = resolve })
    const catalogContinuations = []
    const catalogRouteErrors = []
    const delayedCatalog = (route) => {
      const continuation = catalogGate.then(() => route.continue()).catch((error) => { catalogRouteErrors.push(error) })
      catalogContinuations.push(continuation)
      return continuation
    }
    await customerPage.route(`${base}/api/store/catalog`, delayedCatalog)
    try {
      await customerPage.goto(`${base}/store`)
      await customerPage.getByText('Loading your store…', { exact: true }).waitFor()
      for (const viewport of viewports) await capture(customerPage, 'student-store-loading', viewport, { waitForNetwork: false })
    } finally {
      releaseCatalog()
      // Finish each held request before removing its handler; unroute must not race continue.
      await Promise.all(catalogContinuations)
      await customerPage.unrouteAll({ behavior: 'wait' })
    }
    if (catalogRouteErrors.length) throw catalogRouteErrors[0]
    await settled(customerPage)

    // Assert the deliberate 503 state and successful retry directly, including repeated navigation.
    await verifyCatalogServiceRecovery({ page: customerPage, base, expectedHttpErrors, captureAll })
    await customerPage.goto(`${base}/store`)
    const addWater = customerPage.getByRole('button', { name: 'Add Bottled Water to cart', exact: true })
    await addWater.waitFor()
    await captureAll(customerPage, 'student-store')
    await addWater.click()
    await customerPage.getByText('Choose a room below to continue to order review.', { exact: true }).waitFor()
    assert.equal(await customerPage.getByRole('button', { name: 'Review order', exact: true }).isDisabled(), true)
    for (let i = 0; i < 12; i++) await customerPage.getByRole('button', { name: 'Add one Bottled Water', exact: true }).click()
    await customerPage.getByText('This cart may exceed your MICA Money spending limit. Review the order to confirm.', { exact: true }).waitFor()
    await captureAll(customerPage, 'student-checkout-limit-warning')
    for (let i = 0; i < 12; i++) await customerPage.getByRole('button', { name: 'Remove one Bottled Water', exact: true }).click()
    await customerPage.getByRole('combobox', { name: /^Room/ }).selectOption({ label: 'Room 201' })
    await captureAll(customerPage, 'student-cart')
    await customerPage.getByRole('button', { name: 'Review order', exact: true }).click()
    await customerPage.getByRole('heading', { name: 'Review your order', exact: true }).waitFor()
    await captureAll(customerPage, 'student-order-review')
    await customerPage.route('**/api/store/orders', async route => {
      const committed = await route.fetch()
      assert.equal(committed.status(), 201)
      expectedHttpErrors.set(customerPage, [{ url: route.request().url(), status: 503 }])
      await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ ok: false, error: { code: 'INTERNAL_ERROR', message: 'Order response interrupted' } }) })
    }, { times: 1 })
    await customerPage.getByRole('button', { name: /^Place order/ }).click()
    await customerPage.getByRole('button', { name: 'Recover order', exact: true }).waitFor()
    const retained = await customerPage.evaluate(() => Object.entries(sessionStorage).filter(([key]) => key.startsWith('mica-money:pending-order:')).map(([,value]) => JSON.parse(value)))
    assert.equal(retained.length, 1)
    assert.deepEqual(Object.keys(retained[0]).sort(), ['idempotencyKey','studentId','version'])
    await customerPage.reload()
    await customerPage.getByRole('button', { name: 'Recover order', exact: true }).waitFor()
    await captureAll(customerPage, 'student-opaque-order-recovery')
    const orderResponse = customerPage.waitForResponse(response => response.url().endsWith('/api/store/orders/recover'))
    await customerPage.getByRole('button', { name: 'Recover order', exact: true }).click()
    const placedOrder = await (await orderResponse).json()
    assert.equal(placedOrder.ok, true)
    visualOrderId = placedOrder.data.order_id
    visualOrderNumber = placedOrder.data.order_number
    assert.equal(await customerPage.evaluate(() => Object.keys(sessionStorage).filter(key => key.startsWith('mica-money:pending-order:')).length), 0)
    await customerPage.getByText('Order confirmed', { exact: true }).waitFor()
    await captureAll(customerPage, 'student-order-receipt')
    await customerPage.getByRole('link', { name: 'Track your order', exact: false }).click()
    await customerPage.getByRole('heading', { name: 'My orders', exact: true }).waitFor()
    await captureAll(customerPage, 'student-orders')
    await customerPage.goto(`${base}/store/account`)
    await customerPage.getByRole('heading', { name: 'My account', exact: true }).waitFor()
    await captureAll(customerPage, 'student-account')

    // Other staff workspaces retain each role's actual authorization.
    for (const [route, code, heading, name] of [
      ['/orders', '1001', 'Online orders', 'staff-orders'],
      ['/inventory', '2001', 'Inventory', 'inventory'],
      ['/students', '3001', 'Students', 'students'],
      ['/coupons', '2001', 'Coupons', 'coupons'],
      ['/reports', '3001', 'Reports', 'reports'],
      ['/reports', '2001', 'Reports', 'inventory-reports'],
      ['/settings/payments', '9001', 'Payment settings', 'payment-settings'],
    ]) {
      const staffCookies = await login(code)
      const page = await pageFor(staffCookies)
      await page.goto(base + route)
      await page.getByRole('heading', { name: heading, exact: true }).waitFor()
      await captureAll(page, name)
      if (name === 'inventory-reports') {
        assert.equal(await page.getByRole('heading', { name: 'Inventory value', exact: true }).count(), 1)
        assert.equal(await page.getByRole('region', { name: 'Transaction register', exact: true }).count(), 0)
        await page.clock.fastForward(870000)
        await page.getByRole('button', { name: 'Stay signed in', exact: true }).waitFor()
        await captureAll(page, 'staff-timeout-warning')
        await page.getByRole('button', { name: 'Stay signed in', exact: true }).click()
        await page.getByRole('button', { name: 'Stay signed in', exact: true }).waitFor({ state: 'hidden' })
      }
      if (route === '/orders') {
        await page.getByLabel('Search orders, students, or rooms', { exact: true }).fill(studentName)
        const detail = page.locator('section[aria-labelledby="fulfillment-detail-title"]')
        await detail.getByRole('heading', { name: visualOrderNumber, exact: true }).waitFor()
        await capture(page, 'staff-orders-filtered', viewports[0])
        await detail.getByRole('button', { name: 'Start picking', exact: true }).click()
        await detail.getByRole('heading', { name: 'Pick every item', exact: true }).waitFor()
        const ready = detail.getByRole('button', { name: 'Mark ready for delivery', exact: true })
        assert.equal(await ready.isDisabled(), true, 'Every item must be picked before marking ready')
        await captureAll(page, 'staff-orders-picking')
        for (const checkbox of await detail.getByRole('checkbox').all()) await checkbox.check()
        assert.equal(await ready.isEnabled(), true, 'Checking all full quantities enables readiness')
        let polls = 0
        page.on('request', req => { if (req.url() === `${base}/api/orders` && req.method() === 'GET') polls++ })
        const polled = page.waitForResponse(response => response.url() === `${base}/api/orders`)
        await page.clock.fastForward(20000); await polled
        await page.getByRole('button', { name: 'Refresh queue', exact: true }).waitFor()
        assert.equal(polls, 1, 'One request per polling interval')
        for (const checkbox of await detail.getByRole('checkbox').all()) assert.equal(await checkbox.isChecked(), true)
        await page.context().setOffline(true)
        await page.clock.fastForward(60000)
        assert.equal(polls, 1, 'No polling while offline')
        await page.context().setOffline(false)
        await settled(page)
        await request(staffCookies, `/api/orders/${visualOrderId}/status`, { status: 'READY' })
        const remote = page.waitForResponse(response => response.url() === `${base}/api/orders`)
        await page.clock.fastForward(20000); await remote
        await detail.getByRole('button', { name: 'Start delivery', exact: true }).waitFor()
        assert.equal(await ready.count(), 0, 'Remote state removes the obsolete readiness action')
        await detail.getByRole('button', { name: 'Start delivery', exact: true }).click()
        const deliveredResponse = page.waitForResponse((response) => response.url().endsWith(`/api/orders/${visualOrderId}/status`) && response.request().method() === 'POST' && response.request().postDataJSON()?.status === 'DELIVERED')
        await detail.getByRole('button', { name: 'Confirm delivered', exact: true }).click()
        const delivered = await (await deliveredResponse).json()
        assert.equal(delivered.ok, true)
        assert.equal(delivered.data.status, 'DELIVERED')

        await customerPage.goto(`${base}/store/orders`)
        const customerOrder = customerPage.getByRole('article').filter({ has: customerPage.getByRole('heading', { name: visualOrderNumber, exact: true }) })
        await customerOrder.locator('[data-delivered="true"]').waitFor()
        await customerOrder.getByText('Order details & delivery progress', { exact: true }).click()
        const timeline = customerOrder.getByRole('list', { name: 'Fulfillment timeline', exact: true })
        const shownTimes = await timeline.locator('time').evaluateAll((times) => times.map((time) => time.getAttribute('datetime')))
        const events = await owner.query('select to_status::text as status,created_at from private.online_order_status_events where order_id=$1 order by created_at,id', [visualOrderId])
        assert.deepEqual(events.rows.map((event) => event.status), ['PLACED', 'PICKING', 'READY', 'OUT_FOR_DELIVERY', 'DELIVERED'])
        assert.equal(shownTimes.length, 5, 'Delivered timeline contains all five real event times')
        assert.deepEqual(shownTimes.map((time) => new Date(time).toISOString()), events.rows.map((event) => new Date(event.created_at).toISOString()))
        await captureAll(customerPage, 'student-delivered-timeline')
      }
      if (route === '/inventory') {
        await page.clock.fastForward(180000)
        assert.ok(page.url().includes('/inventory'), 'Receiving remains available beyond two minutes')
        await page.getByRole('button',{name:'Bottled Water',exact:true}).click()
        await page.getByRole('button',{name:'Receive Stock',exact:true}).click()
        await captureAll(page,'inventory-receipt')
        await page.getByRole('button',{name:'Back to products',exact:true}).click()
        for (const [button,screenshot] of [['View Lots','inventory-lots'],['Change Price','inventory-price'],['Adjust Stock','inventory-adjustment']]) {
          const more=page.locator('section.panel').filter({has:page.getByRole('heading',{name:'Bottled Water',exact:true})}).getByText('More',{exact:true})
          await more.click();await page.getByRole('button',{name:button,exact:true}).click();await captureAll(page,screenshot)
          await page.getByRole('button',{name:'Back to products',exact:true}).click()
        }
        await page.getByRole('button',{name:'Add product',exact:true}).click();await captureAll(page,'inventory-product')
      }
      if (route === '/students') {
        await page.clock.fastForward(180000)
        assert.ok(page.url().includes('/students'), 'Student financial records remain available beyond two minutes')
        await page.getByRole('button',{name:/Demo Student/}).first().click()
        await page.getByRole('button',{name:'Wallet History',exact:true}).click()
        await page.getByRole('dialog', { name: 'Demo Student · Wallet history', exact: true }).waitFor()
        await settled(page);await assertDialogFocus(page);await captureAll(page,'students-wallet-history')
        await page.getByRole('button',{name:'Close dialog',exact:true}).click()
        await page.goto(base+'/reports');await page.getByRole('heading',{name:'Reports',exact:true}).waitFor()
        await captureAll(page,'finance-sales')
      }
      await page.context().close()
    }

    const cashierPage = await pageFor(await login('1001'))
    await cashierPage.goto(`${base}/pos`)
    await cashierPage.locator('.payment-methods').getByRole('button', { name: 'MICA Money', exact: true }).waitFor()
    assert.equal(await cashierPage.locator('.payment-methods').getByRole('button', { name: 'Cash', exact: true }).count(), 0, 'Cash is hidden while event acceptance is off')
    assert.equal(await cashierPage.locator('.payment-methods').getByRole('button', { name: 'Split', exact: true }).count(), 0, 'Split is hidden while event acceptance is off')
    assert.equal(await cashierPage.getByText('Event payment settings', { exact: true }).count(), 0, 'Cashiers cannot change event acceptance')
    assert.equal(await cashierPage.getByRole('button', { name: /^Take payment/ }).isDisabled(), true, 'An empty sale cannot enter checkout')
    await captureAll(cashierPage, 'cashier-wallet-only-empty-sale')
    await cashierPage.clock.fastForward(270000)
    await cashierPage.getByRole('button', { name: 'Stay signed in', exact: true }).waitFor()
    await captureAll(cashierPage, 'pos-timeout-warning')
    await cashierPage.getByRole('button', { name: 'Stay signed in', exact: true }).click()
    await cashierPage.getByRole('button', { name: 'Stay signed in', exact: true }).waitFor({ state: 'hidden' })
    for (const kind of ['pointerdown', 'keydown', 'touchstart']) {
      await cashierPage.clock.fastForward(270000)
      await cashierPage.getByRole('button', { name: 'Stay signed in', exact: true }).waitFor()
      await cashierPage.evaluate(type => window.dispatchEvent(new Event(type)), kind)
      await cashierPage.getByRole('button', { name: 'Stay signed in', exact: true }).waitFor({ state: 'hidden' })
    }
    await cashierPage.context().close()

    // Enable event cash on this isolated terminal, then take real cash and split sales.
    const posCookies = await login('9001')
    await request(posCookies, '/api/pos/payment-policy', { cashEnabled: true, endsAt: new Date(Date.now() + 3600000).toISOString(), eventName: 'Visual QA event' })
    const posPage = await pageFor(posCookies)
    await posPage.goto(`${base}/pos`)
    await posPage.getByRole('heading', { name: 'Point of sale', exact: true }).waitFor()
    await captureAll(posPage, 'pos')
    const waterProduct = posPage.locator('.product-card').filter({ has: posPage.getByText('Bottled Water', { exact: true }) })
    await waterProduct.click()
    await posPage.getByRole('button', { name: 'Cash', exact: true }).click()
    await captureAll(posPage, 'pos-cash-cart')
    await posPage.getByRole('button', { name: /^Take payment/ }).click()
    await posPage.getByRole('dialog', { name: 'Review payment' }).waitFor()
    await posPage.getByLabel('Cash received (₩)', { exact: true }).fill('10000')
    await assertDialogFocus(posPage)
    await captureAll(posPage, 'pos-cash-review')
    await posPage.getByRole('button', { name: 'Complete Cash Payment', exact: true }).click()
    await posPage.getByRole('dialog', { name: 'Payment completed' }).waitFor()
    await captureAll(posPage, 'pos-cash-receipt')
    await posPage.getByRole('button', { name: 'Start next sale', exact: true }).click()
    await waterProduct.click()
    await posPage.getByRole('button', { name: 'Split', exact: true }).click()
    assert.equal(await posPage.getByLabel('MICA Money contribution (₩)', { exact: true }).count(), 0, 'Split does not require a guessed amount')
    await captureAll(posPage, 'pos-split-cart')
    await posPage.getByRole('button', { name: /^Take payment/ }).click()
    await posPage.getByRole('dialog', { name: 'Scan MICA Money Card' }).waitFor()
    await captureAll(posPage, 'pos-split-card')
    await posPage.keyboard.type(visualCard, { delay: 8 })
    await posPage.keyboard.press('Enter')
    await posPage.getByRole('dialog', { name: 'Choose MICA Money contribution' }).waitFor()
    await posPage.getByText(studentName, { exact: true }).waitFor()
    await posPage.getByText('Maximum available for this purchase', { exact: true }).waitFor()
    await captureAll(posPage, 'pos-split-capacity')
    await posPage.getByRole('button', { name: 'Switch to MICA Money', exact: true }).waitFor()
    await posPage.getByLabel('MICA Money contribution (₩)', { exact: true }).fill('500')
    await captureAll(posPage, 'pos-split-cash-remainder')
    await posPage.getByRole('button', { name: 'Continue to cash and review', exact: true }).click()
    await posPage.getByRole('dialog', { name: 'Review payment' }).waitFor()
    await posPage.getByLabel('Cash received (₩)', { exact: true }).fill('10000')
    await posPage.getByLabel('Student PIN', { exact: true }).fill(currentPin)
    await captureAll(posPage, 'pos-split-review')
    await posPage.route('**/api/pos/intents/*/confirm', async route => {
      const settled = await route.fetch()
      assert.equal(settled.status(), 200, 'Server settles once before its receipt response is deliberately lost')
      expectedHttpErrors.set(posPage, [{ url: route.request().url(), status: 503 }])
      await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ ok: false, error: { code: 'INTERNAL_ERROR', message: 'Receipt response interrupted' } }) })
    }, { times: 1 })
    await posPage.getByRole('button', { name: 'Complete Split Payment', exact: true }).click()
    await posPage.getByText('Payment result unknown', { exact: true }).waitFor()
    await captureAll(posPage, 'pos-payment-result-unknown')
    await posPage.getByRole('button', { name: 'Recover payment result', exact: true }).click()
    await posPage.getByRole('dialog', { name: 'Payment completed' }).waitFor()
    await captureAll(posPage, 'pos-split-receipt')
    await posPage.getByRole('button', { name: 'Start next sale', exact: true }).click()
    // Maximum action: one student's safe capacity is less than this 24,000 won sale.
    for (let i = 0; i < 20; i++) await waterProduct.click()
    await posPage.getByRole('button', { name: 'Split', exact: true }).click()
    await posPage.getByRole('button', { name: /^Take payment/ }).click()
    await posPage.getByRole('dialog', { name: 'Scan MICA Money Card' }).waitFor()
    await posPage.keyboard.type(visualCard, { delay: 8 }); await posPage.keyboard.press('Enter')
    await posPage.getByRole('button', { name: 'Use maximum MICA Money', exact: true }).click()
    const maximumText = await posPage.locator('.tender-summary div').filter({ hasText: 'Maximum available for this purchase' }).locator('dd').innerText()
    assert.equal(Number(await posPage.getByLabel('MICA Money contribution (₩)', { exact: true }).inputValue()), Number(maximumText.replace(/[^0-9]/g, '')))
    await captureAll(posPage, 'pos-split-maximum')
    await posPage.getByRole('button', { name: 'Close dialog', exact: true }).click()
    await posPage.getByRole('dialog').waitFor({ state: 'hidden' })
    // A real event timestamp expires while a new split cart is selected.
    await request(posCookies, '/api/pos/payment-policy', { cashEnabled: true, eventName: 'Ending QA event', endsAt: new Date(Date.now() + 15000).toISOString() })
    await posPage.reload()
    await posPage.getByText('EVENT MODE', { exact: true }).waitFor()
    await waterProduct.click(); await posPage.getByRole('button', { name: 'Split', exact: true }).click()
    await captureAll(posPage, 'pos-event-active')
    await posPage.getByText('EVENT ENDED', { exact: true }).waitFor({ timeout: 20000 })
    assert.equal(await posPage.locator('.payment-methods').getByRole('button', { name: 'Split', exact: true }).count(), 0)
    assert.equal(await posPage.locator('.payment-methods').getByRole('button', { name: 'Cash', exact: true }).count(), 0)
    assert.equal(await posPage.locator('.payment-methods').getByRole('button', { name: 'MICA Money', exact: true }).getAttribute('aria-pressed'), 'true')
    await captureAll(posPage, 'pos-event-expired')
    // Deliberately remove the required RPC from this disposable database, then retry after restoration.
    expectedHttpErrors.set(posPage, [{ url: `${base}/api/pos/payment-policy`, status: 503 }])
    await owner.query('alter function api.terminal_payment_policy_v2(uuid) rename to visual_hidden_policy')
    try {
      await posPage.reload()
      await posPage.getByText('Database update required', { exact: true }).waitFor()
      await captureAll(posPage, 'pos-database-update-required')
      assert.equal(await posPage.getByRole('button', { name: 'Try again', exact: true }).isEnabled(), true)
    } finally { await owner.query('alter function api.visual_hidden_policy(uuid) rename to terminal_payment_policy_v2') }
    await posPage.getByRole('button', { name: 'Try again', exact: true }).click()
    await posPage.getByText('Database update required', { exact: true }).waitFor({ state: 'hidden' })
    const iconHref = await posPage.locator('link[rel="icon"]').first().getAttribute('href')
    assert.match(iconHref, /icon.svg/)
    assert.equal((await posPage.request.get(new URL(iconHref, base).toString())).status(), 200)
    assert.equal((await posPage.request.get(`${base}/favicon.ico`)).status(), 200)
    await request(posCookies, '/api/pos/payment-policy', { cashEnabled: false, eventName: null })
    const ledger = await owner.query('select count(*)::int as entries from private.wallet_ledger where student_id=$1', [visualStudentId])
    assert.equal(ledger.rows[0].entries, 2, 'Visual student has one online wallet purchase and one split wallet debit')

    assert.deepEqual(pageErrors, [], 'No browser page errors')
    assert.deepEqual(consoleErrors, [], 'No browser console errors')
    assert.deepEqual(findings, [], 'Responsive layout and accessible controls')
    console.log(`PASS: ${screenshots.length} responsive screenshots; enrollment, PIN reset, student login/order/history, cash/split payment and native-dialog keyboard focus`)
  } catch (error) {
    if (lastPage && !lastPage.isClosed()) await lastPage.screenshot({ path: path.join(directory, 'last-failure.png'), fullPage: true }).catch(() => undefined)
    throw error
  } finally {
    fs.writeFileSync(path.join(directory, 'results.json'), JSON.stringify({ screenshots, findings, pageErrors, consoleErrors, expectedConsoleErrors }, null, 2))
    await Promise.allSettled(contexts.map((context) => context.close()))
    await browser.close()
  }
}
