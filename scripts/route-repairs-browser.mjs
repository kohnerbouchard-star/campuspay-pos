import assert from 'node:assert/strict'
import fs from 'node:fs'
import { randomUUID } from 'node:crypto'
import { chromium } from '@playwright/test'

export async function runRouteRepairBrowserChecks({ base, login, request, roster, partial }) {
  assert.ok(['localhost', '127.0.0.1'].includes(new URL(base).hostname))
  const browser = await chromium.launch({ headless: true }), errors = [], captures = []
  fs.mkdirSync('.validation/route-repairs', { recursive: true })
  const cookies = await login('9001'), session = await request(cookies, '/api/auth/session')
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
  await context.addCookies([...cookies].filter(([, value]) => value).map(([name, value]) => ({ name, value, url: base })))
  const page = await context.newPage()
  page.setDefaultTimeout(12000)
  page.on('pageerror', error => errors.push(error.message))
  const capture = async name => {
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 1000 })
      await page.waitForLoadState('networkidle')
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${name}: horizontal overflow`)
      const file = `.validation/route-repairs/${name}-${width}.png`
      await page.screenshot({ path: file, fullPage: true, animations: 'disabled' }); captures.push(file)
    }
  }
  try {
    await page.goto(`${base}/security?studentId=${roster.id}`)
    await page.getByRole('link', { name: 'Complete enrollment', exact: true }).waitFor()
    assert.equal(await page.getByRole('button', { name: 'Authorize protected action' }).count(), 0)
    await capture('roster-enrollment-guidance')
    await page.goto(`${base}/security?studentId=${partial.id}`)
    await page.getByRole('heading', { name: 'Complete missing PIN', exact: true }).waitFor()
    assert.equal(await page.getByRole('button', { name: 'Replace card', exact: true }).count(), 0)
    await capture('incomplete-enrollment-repair')
    await page.getByLabel('I verified this student’s identity and existing card.', { exact: true }).check()
    await page.getByLabel('Super Admin employee ID', { exact: true }).fill('9001')
    await page.getByLabel('Super Admin PIN', { exact: true }).fill('12345678')
    await page.getByRole('button', { name: 'Authorize protected action', exact: true }).click()
    await page.getByLabel('Student enters new PIN', { exact: true }).fill('562914')
    await page.getByLabel('Student confirms new PIN', { exact: true }).fill('562914')
    await page.getByRole('button', { name: 'Complete missing PIN', exact: true }).click()
    await page.getByText(/Missing PIN completed\. The existing student, card and wallet were preserved\./).waitFor()
    await capture('completed-enrollment-repair')
    await page.goto(`${base}/settings/readiness`)
    await page.getByRole('heading', { name: 'Operational readiness', exact: true }).waitFor()
    await page.getByRole('region', { name: 'Capability readiness' }).waitFor()
    await capture('operator-readiness')
    // Persist a missing operation reference, refresh, recover it closed: no stock is removed.
    const key = randomUUID()
    await page.evaluate(({ operatorId, key }) => localStorage.setItem(`campuspay:stock-adjustment:v1:${operatorId}`, key), { operatorId: session.user_id, key })
    await page.goto(`${base}/inventory`)
    await page.getByRole('button', { name: 'Remove stock', exact: true }).click()
    await page.getByRole('button', { name: 'Recover original removal', exact: true }).waitFor()
    assert.equal(await page.getByRole('button', { name: 'Review stock removal', exact: true }).isDisabled(), true)
    await capture('persisted-removal-recovery')
    await page.reload()
    await page.getByRole('button', { name: 'Remove stock', exact: true }).click()
    await page.getByRole('button', { name: 'Recover original removal', exact: true }).click()
    await page.getByText(/original request is closed without a stock removal/).waitFor()
    assert.equal(await page.evaluate(operatorId => localStorage.getItem(`campuspay:stock-adjustment:v1:${operatorId}`), session.user_id), null)
    assert.deepEqual(errors, [])
    fs.writeFileSync('.validation/route-repairs/browser-results.json', JSON.stringify({ passed: true, captures, errors }, null, 2))
  } finally { await browser.close() }
}
