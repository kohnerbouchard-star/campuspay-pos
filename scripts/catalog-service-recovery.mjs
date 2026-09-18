// Used only by the isolated localhost browser acceptance harness.
import assert from 'node:assert/strict'
import { expect } from '@playwright/test'

export async function verifyCatalogServiceRecovery({ page, base, expectedHttpErrors, captureAll }) {
  assert.ok(['localhost', '127.0.0.1'].includes(new URL(base).hostname))
  const catalogUrl = `${base}/api/store/catalog`
  const failure = page.getByRole('alert').filter({ hasText: 'We couldn’t complete that request. Please try again.' })
  const refresh = page.getByRole('button', { name: 'Refresh store', exact: true })
  const water = page.getByRole('button', { name: 'Add Bottled Water to cart', exact: true })
  const loading = page.getByText('Loading your store…', { exact: true })
  const isCatalog = response => response.url() === catalogUrl && response.request().method() === 'GET'
  const errorReady = async () => {
    await expect(failure).toBeVisible()
    await expect(refresh).toBeEnabled()
    await expect(loading).toBeHidden()
    await expect(water).toHaveCount(0)
    await expect(page.locator('[data-nextjs-dialog], .vite-error-overlay')).toHaveCount(0)
  }
  // Repeated navigation/routing and viewport changes previously exposed a networkidle
  // timeout even after the expected error rendered. Readiness is the asserted UI state,
  // not unrelated document-wide network silence; no browser errors are suppressed.
  for (let attempt = 0; attempt < 3; attempt++) {
    let injected = 0
    expectedHttpErrors.set(page, [{ url: catalogUrl, status: 503 }])
    await page.route(catalogUrl, async route => {
      injected++
      await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({
        ok: false, error: { code: 'INTERNAL_ERROR', message: 'Visual QA service interruption' },
      }) })
    }, { times: 1 })
    const [failed] = await Promise.all([
      page.waitForResponse(isCatalog),
      page.goto(`${base}/store`),
    ])
    assert.equal(failed.status(), 503, 'The deliberate catalog failure must be observed')
    assert.equal(injected, 1, 'Exactly one catalog request is deliberately failed')
    await errorReady()
    const name = attempt === 0 ? 'student-store-service-error' : `student-store-service-error-repeat-${attempt}`
    await captureAll(page, name, { ready: errorReady })
    await errorReady()
    const [recovered] = await Promise.all([
      page.waitForResponse(isCatalog),
      refresh.click(),
    ])
    assert.equal(recovered.status(), 200, 'Refresh must fetch the real successful catalog response')
    assert.equal((await recovered.json()).ok, true, 'Recovery must return the real application success envelope')
    await expect(water).toBeVisible()
    await expect(failure).toBeHidden()
    await expect(loading).toBeHidden()
  }
  console.log('PASS: catalog 503 error and real refresh recovery across three navigation cycles and four viewport sizes')
}
