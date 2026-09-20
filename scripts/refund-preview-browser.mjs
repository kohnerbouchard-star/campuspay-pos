import assert from 'node:assert/strict'
import fs from 'node:fs'
import { chromium, expect } from '@playwright/test'

export async function runRefundPreviewBrowser(ctx, cookies, sale) {
  const browser = await chromium.launch({ headless: true }), context = await browser.newContext(), page = await context.newPage()
  const widths = [1440,1024,768,390], errors = [], dir = '.validation/refund-preview'
  let screenshots = 0
  fs.mkdirSync(dir, { recursive: true }); page.setDefaultTimeout(15000); page.on('pageerror', e => errors.push(e.message))
  await context.addCookies([...cookies].filter(([,v]) => v).map(([name,value]) => ({name,value,url:ctx.base})))
  const first = sale.items[0]
  try {
    await page.goto(ctx.base + '/refunds')
    await page.getByLabel('Receipt or online order number').fill(sale.receipt_number)
    await page.getByRole('button', {name:'Find sale',exact:true}).click()
    await page.locator('summary').filter({hasText:'Calculate item-level refund — preview only'}).click()
    const button = page.getByRole('button', {name:'Calculate refund preview',exact:true})
    const restock = page.getByLabel(`Saleable restock quantity — ${first.product_name}`, {exact:true})
    const writeoff = page.getByLabel(`Write-off quantity — ${first.product_name}`, {exact:true})
    for (const width of widths) {
      await page.setViewportSize({width,height:900})
      for (const control of [restock, writeoff]) assert.ok((await control.boundingBox())?.height >= 44, 'Quantity controls retain 44px touch targets')
      await restock.fill('1'); await writeoff.fill('1'); await button.click()
      const estimate = page.getByRole('region', {name:'Item-level refund estimate'})
      await expect(estimate).toBeVisible(); await expect(estimate).toContainText('No refund has been posted.')
      // Capture from the top so off-screen fixed skip links are not painted
      // into the middle of a full-page Chromium screenshot after auto-scroll.
      await page.evaluate(() => window.scrollTo(0, 0))
      await page.screenshot({path:`${dir}/preview-${width}.png`,fullPage:true}); screenshots++
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
      await restock.fill('2'); await expect(estimate).toHaveCount(0)
      await writeoff.fill('2'); await button.click()
      await expect(page.getByRole('alert').filter({hasText:'no more than the quantity sold'})).toBeVisible()
      await writeoff.fill('0')
    }
    await page.route('**/api/refunds/preview', route => route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({ok:false,error:{code:'INTERNAL_ERROR',message:'Synthetic calculation outage'}})}), {times:1})
    await button.click(); await expect(page.getByRole('alert').filter({hasText:'Synthetic calculation outage'})).toBeVisible()
    await button.click(); await expect(page.getByRole('region',{name:'Item-level refund estimate'})).toBeVisible()
    assert.equal(await page.evaluate(() => sessionStorage.getItem('campuspay:refund:v1')), null)
    assert.deepEqual(errors, [])
    fs.writeFileSync(dir+'/browser.json',JSON.stringify({widths,screenshots,unexpectedBrowserErrors:errors,editInvalidatesEstimate:true,calculationRetry:true,minimumQuantityControlHeight:44,liveDataUsed:false},null,2))
  } catch (e) { await page.screenshot({path:dir+'/last-failure.png',fullPage:true}).catch(()=>{}); throw e }
  finally { await context.close(); await browser.close() }
}
