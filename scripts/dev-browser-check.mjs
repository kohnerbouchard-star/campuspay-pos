// Read-only browser verification: no credentials or mutations are sent.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { chromium } from '@playwright/test'
const base = process.env.DEV_VERIFY_URL ?? 'http://localhost:3000'
assert.ok(['localhost', '127.0.0.1'].includes(new URL(base).hostname))
const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
const errors = [], failures = []
page.on('pageerror', error => errors.push(error.message))
page.on('console', entry => { if (entry.type() === 'error') errors.push(entry.text()) })
page.on('response', response => { if (response.status() >= 400) failures.push({ path: new URL(response.url()).pathname, status: response.status() }) })
try {
  await page.goto(base)
  await page.waitForLoadState('networkidle')
  assert.match(page.url(), /\/login/)
  assert.ok((await page.locator('body').innerText()).length > 100)
  assert.equal(await page.locator('[data-nextjs-dialog], .vite-error-overlay').count(), 0)
  assert.ok(await page.getByRole('button', { name: /Sign in/i }).isVisible())
  const icon = await page.locator('link[rel="icon"]').first().getAttribute('href')
  assert.match(icon, /icon.svg/)
  const iconResponse = await page.request.get(new URL(icon, base).toString())
  assert.equal(iconResponse.status(), 200); assert.match(iconResponse.headers()['content-type'], /image\/svg\+xml/)
  assert.equal((await page.request.get(`${base}/favicon.ico`)).status(), 200)
  fs.mkdirSync('.validation/visual', { recursive: true })
  await page.screenshot({ path: '.validation/visual/development-login-icon-1440.png', fullPage: true })
  await page.goto(`${base}/store/login`); await page.waitForLoadState('networkidle')
  assert.equal(await page.getByRole('heading', { name: 'Sign in to MICA Money', exact: true }).count(), 1)
  assert.deepEqual(errors, []); assert.deepEqual(failures, [])
  fs.writeFileSync('.validation/dev-browser-results.json', JSON.stringify({ mode: 'development', pageLoads: true, icon, faviconStatus: 200, errors, failures }, null, 2))
  console.log('PASS: development pages render, application icon and favicon probe return 200, no browser errors; React DevTools notice allowed')
} finally { await browser.close() }
