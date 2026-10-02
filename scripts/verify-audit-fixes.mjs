#!/usr/bin/env node
// Synthetic, disposable localhost acceptance only. Never reads school data.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { randomBytes, randomInt, randomUUID } from 'node:crypto'
import { chromium, expect } from '@playwright/test'
import { refundTestContext } from './refund-test-context.mjs'
let ctx, browser, phase = 'setup'
const checks = [], dir = '.validation/audit-fixes'
fs.mkdirSync(dir, { recursive: true })
try {
  ctx = await refundTestContext(); await ctx.start(false)
  const { owner, request } = ctx, admin = await ctx.login(), inventory = await ctx.login('2001')
  const unchanged = async () => JSON.stringify((await owner.query(`select
    (select md5(string_agg(to_jsonb(w)::text,'' order by w.student_id)) from private.wallets w) wallets,
    (select md5(string_agg(to_jsonb(l)::text,'' order by l.id)) from private.wallet_ledger l) ledger,
    (select md5(string_agg(to_jsonb(c)::text,'' order by c.id)) from private.student_cards c) cards,
    (select md5(string_agg(to_jsonb(s)::text,'' order by s.id)) from private.students s) students`)).rows[0])
  phase = 'read-only readiness and role boundaries'
  const beforeReadiness = await unchanged(), readiness = await request(admin, '/api/administration/readiness')
  assert.equal(readiness.features.length, 7)
  assert.ok(readiness.features.every(x => !x.application && !x.database && !x.effective))
  await request(inventory, '/api/administration/readiness', undefined, 403)
  await request(new Map(), '/api/administration/readiness', undefined, 401)
  assert.equal(await unchanged(), beforeReadiness)
  checks.push('Readiness works with features disabled, denies non-admins, and preserves records')

  phase = 'missing credential recovery'
  const card = randomBytes(12).toString('hex'), code = `AUDIT-${randomBytes(4).toString('hex')}`
  const student = await request(admin, '/api/students', { studentCode: code, displayName: 'Synthetic audit recovery', cardRead: card, pin: ctx.pin, confirmationPin: ctx.pin, idempotencyKey: randomUUID() }, 201)
  // Deliberately reproduce the missing-row defect only inside this disposable DB.
  await owner.query('delete from private.student_credentials where student_id=$1', [student.student_id])
  assert.equal((await request(admin, '/api/administration/readiness')).active_card_missing_pin, 1)
  const beforePin = await unchanged(), newPin = String(randomInt(100000, 1000000))
  const authorize = async id => request(admin, '/api/security/step-up', { superAdminEmployeeCode: '9001', superAdminPin: ctx.staffPin, purpose: 'RESET_STUDENT_PIN', studentId: id })
  const proof = await authorize(student.student_id)
  await request(admin, `/api/security/students/${student.student_id}/pin-reset`, { authorizationToken: 'x'.repeat(64), newPin, confirmationPin: newPin }, 403)
  const reset = await request(admin, `/api/security/students/${student.student_id}/pin-reset`, { authorizationToken: proof.authorizationToken, newPin, confirmationPin: newPin })
  assert.match(reset.audit_reference, /^AUD-PIN-/)
  assert.equal(await unchanged(), beforePin)
  assert.equal((await owner.query("select count(*)::int n from private.student_credentials where student_id=$1 and pin_hash like '$2a$12$%'", [student.student_id])).rows[0].n, 1)
  assert.equal((await owner.query('select event_type from private.audit_events where reference_number=$1', [reset.audit_reference])).rows[0].event_type, 'STUDENT_PIN_INITIALIZED')
  await request(admin, `/api/security/students/${student.student_id}/pin-reset`, { authorizationToken: proof.authorizationToken, newPin, confirmationPin: newPin }, 403)
  const customer = new Map(); await request(customer, '/api/store/login', { cardNumber: card, pin: newPin })
  assert.equal((await request(admin, '/api/administration/readiness')).active_card_missing_pin, 0)
  // A cardless roster entry must still use deliberate enrollment, not PIN reset.
  const rosterId = (await owner.query("insert into private.students(student_code,display_name) values($1,'Synthetic cardless roster') returning id", [`ROSTER-${code}`])).rows[0].id
  const rosterProof = await authorize(rosterId)
  await request(admin, `/api/security/students/${rosterId}/pin-reset`, { authorizationToken: rosterProof.authorizationToken, newPin, confirmationPin: newPin }, 409)
  assert.equal((await owner.query('select count(*)::int n from private.student_credentials where student_id=$1', [rosterId])).rows[0].n, 0)
  checks.push('Active-card missing PIN repaired on same account with fresh elevation; invalid/reused token and cardless bypass rejected')

  phase = 'invalid input response mapping'
  await request(admin, '/api/inventory/products/not-a-uuid/price', { newPriceWon: 1000, reason: 'Invalid identifier test' }, 400)
  await request(admin, '/api/refunds/items?offset=-1', undefined, 400)
  await request(customer, `/api/store/orders/${randomUUID()}/refunds?offset=bad`, undefined, 400)
  checks.push('Malformed path and query inputs produce 400 rather than 500')

  phase = 'stock replay and recovery'
  const product = (await request(inventory, '/api/inventory/products')).find(x => x.sku === 'WATER-001')
  assert.ok(product)
  const stock = async () => Number((await owner.query('select sum(quantity_remaining) quantity from private.inventory_lots where product_id=$1', [product.id])).rows[0].quantity)
  const input = { productId: product.id, quantityToRemove: 1, reasonCode: 'DAMAGED', notes: 'Synthetic audit adjustment', idempotencyKey: randomUUID() }
  const beforeStock = await stock()
  const first = await request(inventory, '/api/inventory/adjustments', input, 201)
  const duplicate = await request(inventory, '/api/inventory/adjustments', input, 201)
  assert.equal(first.reference_id, duplicate.reference_id); assert.equal(await stock(), beforeStock - 1)
  await request(inventory, '/api/inventory/adjustments', { ...input, quantityToRemove: 2 }, 409)
  await request(inventory, '/api/inventory/adjustments', { ...input, notes: 'Changed request body' }, 409)
  await request(admin, '/api/inventory/adjustments/recover', { idempotencyKey: input.idempotencyKey }, 403)
  await ctx.login('2001', inventory)
  const afterRelogin = await request(inventory, '/api/inventory/adjustments/recover', { idempotencyKey: input.idempotencyKey })
  assert.equal(afterRelogin.adjustment.reference_id, first.reference_id)
  assert.equal((await request(inventory, '/api/inventory/adjustments', input, 201)).reference_id, first.reference_id)
  const closedKey = randomUUID()
  assert.equal((await request(inventory, '/api/inventory/adjustments/recover', { idempotencyKey: closedKey })).adjustment, null)
  await request(inventory, '/api/inventory/adjustments', { ...input, idempotencyKey: closedKey }, 409)
  assert.equal(await stock(), beforeStock - 1)
  const concurrent = { ...input, idempotencyKey: randomUUID() }
  const pair = await Promise.all([request(inventory, '/api/inventory/adjustments', concurrent, 201), request(inventory, '/api/inventory/adjustments', concurrent, 201)])
  assert.equal(pair[0].reference_id, pair[1].reference_id); assert.equal(await stock(), beforeStock - 2)
  assert.equal((await owner.query("select has_function_privilege('campuspay_runtime','private.remove_stock_costed(uuid,uuid,uuid,integer,text,text,uuid)','EXECUTE') allowed")).rows[0].allowed, false)
  checks.push('Stock replays bind payload/operator/terminal, concurrent submit removes once, re-login recovery works, closed key blocks late requests')

  phase = 'browser lost stock response and reload'
  browser = await chromium.launch({ headless: true })
  const context = await browser.newContext(), page = await context.newPage(), pageErrors = []
  page.on('pageerror', e => pageErrors.push(e.message))
  await context.addCookies([...inventory].filter(([,v]) => v).map(([name,value]) => ({ name,value,url:ctx.base })))
  await page.goto(ctx.base + '/inventory')
  await page.getByRole('button', { name: 'Remove stock', exact: true }).click()
  await page.getByLabel('Product', { exact: true }).selectOption(product.id)
  await page.getByLabel('Adjustment notes', { exact: true }).fill('Browser lost-response stock removal')
  await page.getByRole('button', { name: 'Review stock removal', exact: true }).click()
  let capturedKey, committedId
  await page.route('**/api/inventory/adjustments', async route => {
    capturedKey = route.request().postDataJSON().idempotencyKey
    const committed = await route.fetch(); assert.equal(committed.status(), 201)
    committedId = (await committed.json()).data.reference_id
    await route.fulfill({ status: 404, contentType: 'text/plain', body: 'The deployment could not be found' })
  }, { times: 1 })
  await page.getByRole('button', { name: 'Confirm removal', exact: true }).click()
  await expect(page.getByRole('dialog').getByRole('button', { name: 'Recover stock removal', exact: true })).toBeEnabled()
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.getByRole('button', { name: 'Remove stock', exact: true }).click()
  const recoverButton = page.getByRole('button', { name: 'Recover stock removal', exact: true })
  await expect(recoverButton).toBeEnabled()
  assert.equal(await page.evaluate(() => sessionStorage.getItem('campuspay.pending-stock-removal.v1')), capturedKey)
  await recoverButton.click()
  await expect(page.getByText(/Stock removal confirmed:/)).toBeVisible()
  assert.equal(await page.evaluate(() => sessionStorage.getItem('campuspay.pending-stock-removal.v1')), null)
  const committedRows = (await owner.query('select id from private.stock_adjustments where idempotency_key=$1', [capturedKey])).rows
  assert.deepEqual(committedRows, [{ id: committedId }])
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 })
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
    await page.screenshot({ path: `${dir}/stock-recovery-${width}.png`, fullPage: true })
  }
  assert.deepEqual(pageErrors, []); await context.close()
  checks.push('Committed stock removal followed by non-JSON 404 survives reload and recovers exactly one adjustment in browser')
  fs.writeFileSync(`${dir}/results.json`, JSON.stringify({ checks, liveDataUsed: false }, null, 2))
  console.log(`Audit fixes passed: ${checks.length} acceptance groups, synthetic localhost only.`)
} catch (e) {
  fs.writeFileSync(`${dir}/failure.txt`, `Phase: ${phase}\n${e.stack ?? 'unknown'}`)
  console.error(`Audit fixes failed at ${phase}: ${e.message ?? 'unknown'}`); process.exitCode = 1
} finally { if (browser) await browser.close(); if (ctx) await ctx.close() }
