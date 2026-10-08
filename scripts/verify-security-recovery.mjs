#!/usr/bin/env node
// Real Next.js/PostgreSQL and browser acceptance using disposable localhost data only.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { randomInt } from 'node:crypto'
import { chromium, expect } from '@playwright/test'
import { refundTestContext } from './refund-test-context.mjs'
const directory = '.validation/security-recovery'
fs.mkdirSync(directory, { recursive: true })
let ctx, browser, phase = 'setup'
const checks = []
try {
  ctx = await refundTestContext()
  await ctx.start(false)
  const admin = await ctx.login(), { owner, request } = ctx
  const student = (await owner.query('select s.id from private.students s join private.student_credentials c on c.student_id=s.id where s.active order by s.id limit 1')).rows[0]
  assert.ok(student)
  const before = (await owner.query('select pin_hash from private.student_credentials where student_id=$1', [student.id])).rows[0].pin_hash
  const auditCount = async () => Number((await owner.query("select count(*) from private.audit_events where event_type='STUDENT_PIN_RESET' and subject_id=$1", [student.id])).rows[0].count)
  const initialCount = await auditCount()
  const unchanged = async () => JSON.stringify((await owner.query(`select
    (select md5(string_agg(to_jsonb(w)::text,'' order by w.student_id)) from private.wallets w) wallets,
    (select md5(string_agg(to_jsonb(l)::text,'' order by l.id)) from private.wallet_ledger l) ledger,
    (select md5(string_agg(to_jsonb(c)::text,'' order by c.id)) from private.student_cards c) cards,
    (select md5(string_agg(to_jsonb(s)::text,'' order by s.id)) from private.students s) students`)).rows[0])
  const preserved = await unchanged()
  phase = 'real approval denial'
  const invalidPin = ctx.staffPin === '00000000' ? '11111111' : '00000000'
  const denial = await request(admin, '/api/security/step-up', { superAdminEmployeeCode: '9001', superAdminPin: invalidPin, purpose: 'RESET_STUDENT_PIN', studentId: student.id }, 401)
  assert.equal(denial.code, 'INVALID_PIN')
  checks.push('Real invalid approving PIN returns INVALID_PIN rather than requester-session expiry')

  browser = await chromium.launch({ headless: true })
  const context = await browser.newContext(), page = await context.newPage(), pageErrors = []
  page.on('pageerror', error => pageErrors.push(error.message))
  await context.addCookies([...admin].filter(([, value]) => value).map(([name, value]) => ({ name, value, url: ctx.base })))
  await page.goto(`${ctx.base}/security?studentId=${student.id}`)
  const codeField = page.getByLabel('Approving employee ID', { exact: true })
  const pinField = page.getByLabel('Approving employee PIN', { exact: true })
  const authorize = page.getByRole('button', { name: 'Authorize protected action', exact: true })
  const actionAlert = page.getByRole('region', { name: 'PIN and card replacement', exact: true }).getByRole('alert')
  const fillApproval = async () => { await codeField.fill('9101'); await pinField.fill(ctx.staffPin) }
  phase = 'browser approval denial'
  await codeField.fill('9001'); await pinField.fill(invalidPin); await authorize.click()
  await expect(actionAlert).toContainText('Independent approval was denied')
  await expect(page.getByRole('link', { name: 'Sign in to staff account' })).toHaveCount(0)
  await expect(pinField).toHaveValue('')
  assert.equal(await auditCount(), initialCount)
  checks.push('Browser distinguishes approving credentials from requester session and clears PIN')

  phase = 'committed reset followed by lost non-JSON response'
  await fillApproval(); await authorize.click()
  await expect(page.getByLabel('Student enters new PIN', { exact: true })).toBeVisible()
  const newPin = String(randomInt(100000, 1000000))
  await page.getByLabel('Student enters new PIN', { exact: true }).fill(newPin)
  await page.getByLabel('Student confirms new PIN', { exact: true }).fill(newPin)
  let resetRequests = 0
  await page.route('**/api/security/students/*/pin-reset', async route => {
    resetRequests++
    const result = await route.fetch()
    assert.equal(result.status(), 200)
    assert.ok((await result.json()).data.audit_reference)
    await route.fulfill({ status: 404, contentType: 'text/plain', body: 'The deployment could not be found. SECRET_DO_NOT_ECHO' })
  }, { times: 1 })
  await page.getByRole('button', { name: 'Complete PIN reset', exact: true }).click()
  await expect(actionAlert).toContainText('The PIN or card may already have changed')
  await expect(authorize).toBeDisabled()
  await expect(codeField).toBeDisabled()
  await expect(page.getByLabel('Search students', { exact: true })).toBeDisabled()
  assert.equal(resetRequests, 1)
  assert.equal(await auditCount(), initialCount + 1)
  assert.notEqual((await owner.query('select pin_hash from private.student_credentials where student_id=$1', [student.id])).rows[0].pin_hash, before)
  assert.ok(!(await page.locator('body').innerText()).includes('SECRET_DO_NOT_ECHO'))
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 })
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
    await page.screenshot({ path: `${directory}/unconfirmed-reset-${width}.png`, fullPage: true })
  }
  checks.push('A real committed reset with a substituted deployment 404 remains unconfirmed, blocks resubmission, and creates one audit event')

  phase = 'malformed approval fails closed'
  await page.getByRole('button', { name: 'Status checked — request fresh approval', exact: true }).click()
  await page.route('**/api/security/step-up', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, data: { authorizationToken: 'x'.repeat(43), expiresAt: 'invalid' } }) }), { times: 1 })
  await fillApproval(); await authorize.click()
  await expect(actionAlert).toContainText('No reset was submitted')
  await expect(page.getByRole('button', { name: 'Complete PIN reset', exact: true })).toHaveCount(0)
  checks.push('Malformed approval never opens a protected action')

  phase = 'requester session expiry'
  await page.route('**/api/security/step-up', route => route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ ok: false, error: { code: 'SESSION_EXPIRED', message: 'Sign in again' } }) }), { times: 1 })
  await fillApproval(); await authorize.click()
  await expect(page.getByRole('link', { name: 'Sign in to staff account' })).toHaveAttribute('href', '/login?expired=1&next=%2Fsecurity')
  await expect(authorize).toBeDisabled()
  assert.equal(await auditCount(), initialCount + 1)
  assert.equal(await unchanged(), preserved)
  assert.deepEqual(pageErrors, [])
  checks.push('Requester expiry requires staff sign-in; students, cards, wallets and ledger unchanged')
  await context.close()
  fs.writeFileSync(`${directory}/results.json`, JSON.stringify({ checks, pageErrors, liveDataUsed: false }, null, 2))
  console.log(`Security recovery acceptance passed: ${checks.length} groups, disposable localhost only.`)
} catch (error) {
  fs.writeFileSync(`${directory}/failure.txt`, `Phase: ${phase}\n${error.stack ?? 'unknown'}`)
  console.error(`Security recovery failed at ${phase}: ${error.message ?? 'unknown'}`)
  process.exitCode = 1
} finally {
  if (browser) await browser.close()
  if (ctx) await ctx.close()
}
