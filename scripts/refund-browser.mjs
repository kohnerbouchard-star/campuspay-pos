import assert from 'node:assert/strict'
import fs from 'node:fs'
import { chromium, expect } from '@playwright/test'
export async function runRefundBrowser({ base, owner, admin, sale, refunds }) {
  assert.ok(['localhost','127.0.0.1'].includes(new URL(base).hostname))
  assert.ok(['localhost','127.0.0.1'].includes(owner.connectionParameters.host))
  const browser = await chromium.launch({ headless: true })
  const captures = [], pageErrors = [], consoleErrors = [], expected = new Set()
  let page
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' })
    await context.addCookies([...admin].filter(([,value]) => value).map(([name,value]) => ({ name,value,url:base })))
    page = await context.newPage(); page.setDefaultTimeout(15000)
    page.on('pageerror', error => pageErrors.push(error.message))
    page.on('console', entry => { if (entry.type() === 'error' && !(expected.has(entry.location().url) && /Failed to load resource/.test(entry.text()))) consoleErrors.push(entry.text()) })
    async function capture(name) {
      for (const width of [1440,1024,768,390]) {
        await page.setViewportSize({ width,height:1000 })
        await expect(page.getByRole('heading', { name:'Refunds', exact:true })).toBeVisible()
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true)
        const file = `.validation/refunds/${name}-${width}.png`; await page.screenshot({ path:file,fullPage:true }); captures.push(file)
      }
    }
    async function prepare(s) {
      await page.goto(base + '/refunds')
      await page.getByLabel('Receipt or online order number', { exact:true }).fill(s.detail.receipt_number)
      await page.getByRole('button', { name:'Find sale', exact:true }).click()
      await expect(page.getByRole('button', { name:'Post full refund',exact:true })).toBeDisabled()
      for (const item of s.detail.items) await page.getByRole('combobox',{name:`Disposition for ${item.product_name}`,exact:true}).selectOption('RESTOCK')
      await page.getByRole('combobox',{name:/^Refund reason/}).selectOption('OTHER')
      await page.getByLabel('Refund notes',{exact:true}).fill('Browser verified synthetic full return')
      await page.getByRole('checkbox',{name:/I verified this receipt/}).check()
      await expect(page.getByRole('button',{name:'Post full refund',exact:true})).toBeEnabled()
    }
    const wallet = await sale(); await prepare(wallet); await capture('refund-review')
    const endpoint = base + '/api/refunds'; expected.add(endpoint)
    await page.route(endpoint, async route => { const response = await route.fetch(); assert.equal(response.status(),200); assert.equal((await response.json()).data.outcome,'COMPLETED'); await route.abort('failed') }, {times:1})
    await page.getByRole('button',{name:'Post full refund',exact:true}).click()
    await expect(page.getByText('Refund result unknown. Recover the result before starting another refund or paying cash.',{exact:true})).toBeVisible()
    const saved = await page.evaluate(() => JSON.parse(sessionStorage.getItem('campuspay:refund:v1')))
    assert.deepEqual(Object.keys(saved).sort(), ['idempotencyKey','saleId']); assert.equal(saved.saleId,wallet.detail.sale_id)
    await page.reload(); await page.getByRole('button',{name:'Recover refund result',exact:true}).click()
    await expect(page.getByRole('heading',{name:'Refund recorded',exact:true})).toBeVisible()
    assert.equal(await refunds(wallet.detail.sale_id),1)
    assert.equal(await page.evaluate(() => sessionStorage.getItem('campuspay:refund:v1')),null)
    await capture('refund-recovered')
    const cash = await sale({mode:'CASH'}); await prepare(cash)
    await page.getByRole('button',{name:'Post full refund',exact:true}).click()
    await expect(page.getByRole('heading',{name:'Cash handover remains unresolved',exact:true})).toBeVisible()
    const payoutEndpoint = base + '/api/refunds/payout'; expected.add(payoutEndpoint)
    await page.route(payoutEndpoint, async route => { const response = await route.fetch(); assert.equal(response.status(),200); await route.abort('failed') }, {times:1})
    await page.getByLabel('Cash handover reference',{exact:true}).fill('QA browser cash handover')
    await page.getByRole('checkbox',{name:/I verified that this exact cash amount/}).check()
    await page.getByRole('button',{name:'Record cash paid',exact:true}).click()
    await expect(page.getByText('Payout recording is unconfirmed. Refresh the authoritative status. Do not hand over cash again.',{exact:true})).toBeVisible()
    await page.getByRole('button',{name:'Refresh payout status',exact:true}).click()
    await expect(page.getByText('Cash payout recorded: QA browser cash handover. Do not pay again.',{exact:true})).toBeVisible()
    const count = (await owner.query('select count(*) from private.cash_refund_payouts p join private.sale_refunds r on r.id=p.refund_id where r.sale_id=$1',[cash.detail.sale_id])).rows[0].count
    assert.equal(count,'1'); await capture('cash-payout-recovered')
    await page.getByRole('button',{name:'Load reconciliation',exact:true}).click()
    await expect(page.getByText('Net margin after write-offs',{exact:true})).toBeVisible(); await capture('net-reconciliation')
    assert.deepEqual(pageErrors,[]); assert.deepEqual(consoleErrors,[])
    fs.writeFileSync('.validation/refunds/browser.json',JSON.stringify({passed:true,captures,pageErrors,consoleErrors,productionAccess:false},null,2))
    await context.close()
  } catch (error) {
    if (page && !page.isClosed()) await page.screenshot({path:'.validation/refunds/last-failure.png',fullPage:true}).catch(() => undefined)
    fs.writeFileSync('.validation/refunds/browser.json',JSON.stringify({passed:false,captures,pageErrors,consoleErrors,productionAccess:false},null,2))
    throw error
  } finally { await browser.close() }
}
