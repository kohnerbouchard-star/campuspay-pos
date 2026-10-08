import assert from 'node:assert/strict'
import { pathToFileURL } from 'node:url'
import { chromium, expect } from '@playwright/test'
import { photoContext, photoReason } from './product-photo-context.mjs'

export async function verifyPhotoNavigation(ctx, admin, product, checks) {
  const browser = await chromium.launch({ headless: true })
  try {
    for (const width of [1440, 390]) {
      const context = await browser.newContext({ viewport: { width, height: 1000 } })
      try {
        await context.addCookies([...admin].filter(([, value]) => value).map(([name, value]) => ({ name, value, url: ctx.base })))
        const page = await context.newPage(), errors = [], writes = [], dialogs = []
        let leave = false
        page.on('pageerror', error => errors.push(error.message))
        page.on('request', request => {
          if (request.method() !== 'GET' && /\/photo(?:\/cancel)?$/.test(new URL(request.url()).pathname)) writes.push(request.method())
        })
        page.on('dialog', async dialog => { dialogs.push(dialog.message()); await (leave ? dialog.accept() : dialog.dismiss()) })
        const open = async () => {
          await page.goto(ctx.base + '/inventory')
          await page.getByRole('button', { name: product.name, exact: true }).click()
          await page.locator('summary').filter({ hasText: /^More$/ }).click()
          await page.getByRole('button', { name: 'Edit / Archive', exact: true }).click()
          await page.getByRole('button', { name: 'Edit product', exact: true }).click()
          const editor = page.getByRole('region', { name: 'Product photo', exact: true })
          await expect(editor.getByRole('button', { name: 'Check photo status', exact: true })).toBeEnabled()
          return editor
        }
        const go = async (keyboard = false) => {
          if (width === 390 && !await page.getByRole('dialog', { name: 'Workspaces', exact: true }).isVisible()) await page.getByRole('button', { name: 'Menu', exact: true }).click()
          const link = page.locator('a[href="/register"]:visible').first()
          if (keyboard) { await link.focus(); await link.press('Enter') } else await link.click()
        }
        let editor = await open()
        await editor.getByLabel('Choose product photo', { exact: true }).setInputFiles({ name: 'synthetic-draft.png', mimeType: 'image/png', buffer: await ctx.image() })
        await editor.getByRole('combobox', { name: 'Photo crop', exact: true }).selectOption('square')
        await editor.getByRole('textbox', { name: 'Reason for photo change', exact: true }).fill(photoReason)
        await go(true)
        assert.equal(dialogs.length, 1)
        assert.match(dialogs[0], /Submitted photo changes are not cancelled/)
        assert.equal(new URL(page.url()).pathname, '/inventory')
        if (width === 390) await page.keyboard.press('Escape')
        await expect(editor.getByAltText('New photo preview of ' + product.name)).toBeVisible()
        await expect(editor.getByRole('combobox', { name: 'Photo crop', exact: true })).toHaveValue('square')
        await expect(editor.getByRole('textbox', { name: 'Reason for photo change', exact: true })).toHaveValue(photoReason)
        assert.deepEqual(writes, [])
        leave = true
        await go(); await page.waitForURL('**/register'); await expect(page.getByRole('heading', { name: 'Point of sale', exact: true })).toBeVisible()
        assert.equal(dialogs.length, 2)
        editor = await open()
        assert.equal(dialogs.length, 2, 'Reopening after accepted leave must not prompt again')
        await expect(editor.getByAltText('New photo preview of ' + product.name)).toHaveCount(0)
        assert.deepEqual(writes, [])
        // A clean editor must not leave a stale global listener behind.
        await go(); await page.waitForURL('**/register'); await expect(page.getByRole('heading', { name: 'Point of sale', exact: true })).toBeVisible(); assert.equal(dialogs.length, 2)
        editor = await open()
        await ctx.rateReset()
        await editor.getByLabel('Choose product photo', { exact: true }).setInputFiles({ name: 'synthetic-pending.png', mimeType: 'image/png', buffer: await ctx.image() })
        await editor.getByRole('textbox', { name: 'Reason for photo change', exact: true }).fill(photoReason)
        await editor.getByRole('button', { name: 'Upload and validate photo', exact: true }).click()
        await expect(editor.getByRole('button', { name: 'Save photo', exact: true })).toBeEnabled()
        const references = () => page.evaluate(() => Object.entries(sessionStorage).filter(([key]) => key.startsWith('campuspay:product-photo:')))
        const pending = await references(); assert.equal(pending.length, 1)
        await go(); await page.waitForURL('**/register'); await expect(page.getByRole('heading', { name: 'Point of sale', exact: true })).toBeVisible(); assert.equal(dialogs.length, 3)
        assert.deepEqual(await references(), pending)
        editor = await open()
        await expect(editor.getByRole('button', { name: 'Save photo', exact: true })).toBeEnabled()
        assert.deepEqual(await references(), pending)
        assert.deepEqual(writes, ['POST'])
        assert.equal((await ctx.read(admin, product.id, pending[0][1])).operation.state, 'READY')
        await editor.getByRole('button', { name: 'Cancel pending photo change', exact: true }).click()
        await expect(editor).toContainText('Pending photo change cancelled.')
        assert.deepEqual(await references(), [])
        assert.deepEqual(errors, [])
        checks.push(`${width}px photo navigation: keyboard cancellation preserves local draft; mouse-confirmed leave discards only local draft; clean navigation has no prompt; staged upload recovers unchanged without save/cancel side effects`)
      } finally { await context.close() }
    }
  } finally { await browser.close() }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let ctx
  try {
    ctx = await photoContext(); await ctx.start(false)
    const admin = await ctx.login(), product = (await ctx.request(admin, '/api/pos/catalog')).find(row => row.sku === 'WATER-001')
    assert.ok(product)
    const checks = []; await verifyPhotoNavigation(ctx, admin, product, checks)
    console.log(JSON.stringify({ result: 'PASS', checks }, null, 2))
  } finally { await ctx?.close() }
}
