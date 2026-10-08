import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import { chromium, expect } from '@playwright/test'
import { photoOrigin, photoReason } from './product-photo-context.mjs'

export async function verifyPhotoBrowser(ctx, admin, customer, product, checks, evidence) {
  const browser = await chromium.launch({ headless: true })
  const contexts = [], pageErrors = [], networkFailures = []
  const root = '.validation/product-photos', endpoint = `/api/inventory/products/${product.id}/photo`
  await fs.mkdir(root, { recursive: true })
  async function pageFor(cookies, width) {
    const context = await browser.newContext({ viewport: { width, height: 1000 } }); contexts.push(context)
    await context.addCookies([...cookies].filter(([, value]) => value).map(([name, value]) => ({ name, value, url: ctx.base })))
    const page = await context.newPage()
    page.on('pageerror', error => pageErrors.push(error.message))
    page.on('requestfailed', request => networkFailures.push({ path: new URL(request.url()).pathname, error: request.failure()?.errorText }))
    await page.route(`${photoOrigin}/**`, async route => {
      try { await route.fulfill({ status: 200, contentType: 'image/webp', body: await fs.readFile(ctx.fileFor(route.request().url())) }) }
      catch (error) { if (error.code !== 'ENOENT') throw error; await route.fulfill({ status: 404, body: 'Synthetic photo missing' }) }
    })
    return page
  }
  async function openEditor(page) {
    await page.goto(ctx.base + '/inventory')
    await page.getByRole('button', { name: product.name, exact: true }).click()
    await page.locator('summary').filter({ hasText: /^More$/ }).click()
    await page.getByRole('button', { name: 'Edit / Archive', exact: true }).click()
    await page.getByRole('button', { name: 'Edit product', exact: true }).click()
    const editor = page.getByRole('region', { name: 'Product photo', exact: true })
    await expect(editor.getByRole('button', { name: 'Check photo status', exact: true })).toBeEnabled()
    return editor
  }
  const button = (editor, name) => editor.getByRole('button', { name, exact: true })
  const choose = async (editor, format = 'png', background = '#2b7584') => editor.getByLabel('Choose product photo', { exact: true }).setInputFiles({ name: `synthetic-product.${format}`, mimeType: `image/${format}`, buffer: await ctx.image(format, background) })
  async function stage(editor) {
    await editor.getByRole('textbox', { name: 'Reason for photo change', exact: true }).fill(photoReason)
    await button(editor, 'Upload and validate photo').click()
    await expect(button(editor, 'Save photo')).toBeEnabled()
    await expect(editor).toContainText('New photo uploaded and validated.')
  }
  async function capture(page, name, locator) {
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${name}: no horizontal document overflow`)
    if (locator) await locator.scrollIntoViewIfNeeded()
    const file = `${name}.png`
    await page.screenshot({ path: `${root}/${file}`, fullPage: false }); evidence.push(file)
  }
  try {
    const desktop = await pageFor(admin, 1440), editor = await openEditor(desktop)
    await expect(editor.locator('[data-product-photo="missing"]')).toHaveCount(1)
    await editor.getByLabel('Choose product photo', { exact: true }).setInputFiles({ name: 'fake.png', mimeType: 'image/png', buffer: Buffer.from('<svg/>') })
    await expect(editor.getByRole('alert')).toContainText('header could not be read')
    await editor.getByLabel('Choose product photo', { exact: true }).setInputFiles({ name: 'oversized.png', mimeType: 'image/png', buffer: Buffer.alloc(4_000_001) })
    await expect(editor.getByRole('alert')).toContainText('4 MB')
    await choose(editor)
    await editor.getByRole('combobox', { name: 'Photo crop', exact: true }).selectOption('square')
    const horizontal = editor.getByRole('slider', { name: 'Crop horizontal position', exact: true })
    await horizontal.focus(); await horizontal.press('ArrowRight'); await expect(horizontal).toHaveValue('51')
    const nameDraft = `${product.name} unsaved draft`
    await desktop.getByRole('textbox', { name: 'Product name', exact: true }).fill(nameDraft)
    await editor.getByRole('textbox', { name: 'Reason for photo change', exact: true }).fill(photoReason)
    await editor.getByRole('textbox', { name: 'Reason for photo change', exact: true }).press('Enter')
    await expect(desktop.getByRole('dialog')).toHaveCount(0)
    await expect(desktop.getByRole('button', { name: 'Back to products', exact: true })).toBeDisabled()
    await capture(desktop, 'editor-desktop-crop', editor)
    await ctx.rateReset(); await stage(editor)
    await capture(desktop, 'editor-desktop-validated-preview', editor)
    await button(editor, 'Save photo').click(); await expect(editor).toContainText('Photo change saved.')
    await expect(desktop.getByRole('textbox', { name: 'Product name', exact: true })).toHaveValue(nameDraft)
    assert.equal((await ctx.owner.query('select name from public.products where id=$1', [product.id])).rows[0].name, product.name)
    await expect(editor.locator('[data-product-photo="loaded"]')).toHaveCount(1)
    checks.push('Real desktop editor validates files, supports keyboard crop, preserves unrelated product drafts and guards internal navigation while pending')

    await ctx.rateReset()
    let lostUploadId
    await desktop.route(`**${endpoint}`, async route => {
      if (route.request().method() !== 'POST') { await route.fallback(); return }
      const response = await route.fetch(); assert.equal(response.status(), 200)
      const metadata = JSON.parse(decodeURIComponent(route.request().headers()['x-photo-metadata']))
      lostUploadId = metadata.requestId
      await route.abort('failed')
    })
    await choose(editor, 'webp', '#c7933e')
    await editor.getByRole('textbox', { name: 'Reason for photo change', exact: true }).fill(photoReason)
    await button(editor, 'Upload and validate photo').click()
    await expect(editor.getByRole('alert')).toContainText('upload result is unknown')
    await desktop.unroute(`**${endpoint}`)
    await button(editor, 'Check photo status').click(); await expect(button(editor, 'Save photo')).toBeEnabled()
    assert.equal((await ctx.read(admin, product.id, lostUploadId)).operation.state, 'READY')
    await button(editor, 'Cancel pending photo change').click(); await expect(editor).toContainText('Pending photo change cancelled.')
    await expect(button(editor, 'Retry selected photo')).toBeVisible()
    await button(editor, 'Retry selected photo').click(); await expect(editor.getByAltText(`New photo preview of ${product.name}`)).toBeVisible()
    await stage(editor)
    let lostSaveId
    await desktop.route(`**${endpoint}`, async route => {
      if (route.request().method() !== 'PUT') { await route.fallback(); return }
      lostSaveId = route.request().postDataJSON().requestId
      const response = await route.fetch(); assert.equal(response.status(), 200); await route.abort('failed')
    })
    await button(editor, 'Save photo').click(); await expect(editor.getByRole('alert')).toBeVisible()
    await expect.poll(() => !!lostSaveId).toBe(true)
    assert.equal((await ctx.read(admin, product.id, lostSaveId)).operation.state, 'SAVED')
    assert.equal(await desktop.evaluate(id => Object.values(sessionStorage).includes(id), lostSaveId), true)
    await desktop.unroute(`**${endpoint}`)
    const reloaded = await openEditor(desktop)
    await expect(reloaded).toContainText('Photo change saved.')
    assert.equal(await desktop.evaluate(id => Object.values(sessionStorage).includes(id), lostSaveId), false)
    assert.equal((await ctx.owner.query("select count(*) n from private.audit_events where reference_number=$1 and event_type='PRODUCT_PHOTO_SAVED'", [`PHOTO-${lostSaveId}`])).rows[0].n, '1')
    checks.push('Lost upload response recovers the original staged candidate; cancel/retry works; committed-but-lost save survives navigation/reload with one audit event')

    await ctx.rateReset()
    let held, release
    const wait = new Promise(resolve => { release = resolve })
    await desktop.route(`**${endpoint}`, async route => {
      if (route.request().method() !== 'POST') { await route.fallback(); return }
      held = { bytes: route.request().postDataBuffer(), metadata: JSON.parse(decodeURIComponent(route.request().headers()['x-photo-metadata'])) }
      await wait
      await route.abort('failed').catch(() => {})
    })
    await choose(reloaded, 'png', '#825bc2')
    await reloaded.getByRole('textbox', { name: 'Reason for photo change', exact: true }).fill(photoReason)
    await button(reloaded, 'Upload and validate photo').click()
    await expect.poll(() => !!held).toBe(true)
    await expect(reloaded.locator('progress')).toBeVisible()
    await button(reloaded, 'Cancel pending photo change').click()
    release(); await expect(reloaded).toContainText('Pending photo change cancelled.')
    await desktop.unroute(`**${endpoint}`)
    const late = await ctx.upload(admin, product.id, held.bytes, held.metadata.revision, held.metadata.requestId)
    assert.equal(late.data.operation.state, 'CANCELLED')
    checks.push('In-flight upload progress and cancellation work; actual delayed original request is fenced by the cancellation tombstone')

    const mobile = await pageFor(admin, 390), phoneEditor = await openEditor(mobile)
    await ctx.rateReset(); await choose(phoneEditor, 'jpeg', '#398669'); await stage(phoneEditor)
    const current = await ctx.read(admin, product.id), second = await ctx.login('9101')
    const external = await ctx.upload(second, product.id, await ctx.image('png', '#456da0'), current.revision)
    await ctx.commit(second, product.id, external.requestId)
    await button(phoneEditor, 'Save photo').click(); await expect(phoneEditor).toContainText('Another editor changed this photo.')
    assert.equal((await ctx.read(admin, product.id)).photo.asset_id, external.data.operation.photo.asset_id)
    await capture(mobile, 'editor-mobile-concurrent-change', phoneEditor)
    await button(phoneEditor, 'Remove current photo').click()
    await phoneEditor.getByRole('textbox', { name: 'Reason for photo change', exact: true }).fill(photoReason)
    await button(phoneEditor, 'Keep current photo').click()
    await expect(phoneEditor.locator('[data-product-photo="loaded"]')).toHaveCount(1)
    await button(phoneEditor, 'Remove current photo').click(); await button(phoneEditor, 'Confirm photo removal').click()
    await expect(phoneEditor).toContainText('Photo change saved.'); await expect(phoneEditor.locator('[data-product-photo="missing"]')).toHaveCount(1)
    await capture(mobile, 'editor-mobile-removed-fallback', phoneEditor)
    await ctx.rateReset(); await choose(phoneEditor, 'png', '#286c8e'); await stage(phoneEditor); await button(phoneEditor, 'Save photo').click()
    await expect(phoneEditor).toContainText('Photo change saved.')
    await capture(mobile, 'editor-mobile-saved', phoneEditor)
    checks.push('Actual mobile editor detects concurrent changes, preserves the winning image, confirms/cancels removal and supports replacement with responsive layout')

    const currentPhoto = (await ctx.read(admin, product.id)).photo
    for (const width of [1440, 390]) {
      const pos = await pageFor(admin, width); await pos.goto(ctx.base + '/pos')
      const card = pos.getByRole('button', { name: new RegExp(product.name) }).filter({ has: pos.locator('.product-price') })
      await expect(card.locator('[data-product-photo="loaded"]')).toHaveCount(1)
      assert.equal(await card.locator('img').evaluate(element => getComputedStyle(element).objectFit), 'contain')
      await capture(pos, `pos-products-${width}`, card)
      const store = await pageFor(customer, width); await store.goto(ctx.base + '/store')
      await expect(store.locator(`img[src="${currentPhoto.thumbnail_url}"]`).first()).toBeVisible()
      await capture(store, `store-catalog-${width}`, store.locator(`img[src="${currentPhoto.thumbnail_url}"]`).first())
    }
    const fallback = await pageFor(admin, 1440)
    let deliver
    const imageHold = new Promise(resolve => { deliver = resolve })
    await fallback.route(currentPhoto.thumbnail_url, async route => { await imageHold; await route.fulfill({ status: 404, body: 'Synthetic missing image' }) })
    await fallback.goto(ctx.base + '/pos')
    const photoCard = fallback.getByRole('button', { name: new RegExp(product.name) }).filter({ has: fallback.locator('.product-price') })
    await expect(photoCard.locator('[data-product-photo="loading"]')).toHaveCount(1)
    const before = await photoCard.boundingBox(); deliver()
    await expect(photoCard.locator('[data-product-photo="failed"]')).toHaveCount(1)
    const after = await photoCard.boundingBox(); assert.deepEqual(after, before)
    await expect(fallback.locator('[data-product-photo="missing"]').first()).toBeVisible()
    await capture(fallback, 'pos-image-failure-fixed-layout', photoCard)
    checks.push('Desktop/mobile POS and authenticated store catalog render shared aspect-preserving photos; loading/missing/failed-image states preserve card geometry')
    const cashierPage = await pageFor(await ctx.login('1001'), 390)
    await cashierPage.goto(ctx.base + '/pos'); await expect(cashierPage.getByRole('region', { name: 'Product photo', exact: true })).toHaveCount(0)
    assert.deepEqual(pageErrors, [])
    // Expected injected failures remain visible evidence, not blanket-suppressed errors.
    await fs.writeFile(`${root}/browser-network-failures.json`, JSON.stringify(networkFailures, null, 2))
    assert.ok(networkFailures.some(event => event.path === endpoint))
    return { pageErrors, expectedInterruptedRequests: networkFailures.filter(event => event.path === endpoint).length }
  } finally { for (const context of contexts) await context.close(); await browser.close() }
}
