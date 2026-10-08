// Real browser/API regression; disposable localhost database and synthetic cash only.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { randomUUID } from 'node:crypto'
import { chromium, expect } from '@playwright/test'
import { refundTestContext } from './refund-test-context.mjs'
let ctx,browser,page,release
const checks=[],dir='.validation/refund-readiness-submit'
fs.mkdirSync(dir,{recursive:true})
try {
 ctx=await refundTestContext();await ctx.start(true,{cash:true})
 await ctx.owner.query('update private.system_settings set refunds_enabled=true,cash_controls_enabled=true where singleton')
 const admin=await ctx.login()
 await ctx.request(admin,'/api/cash/open',{requestKey:randomUUID(),counts:{'10000':2},verified:true})
 await ctx.request(admin,'/api/pos/payment-policy',{cashEnabled:true,eventName:'Synthetic readiness fixture',endsAt:new Date(Date.now()+3600000).toISOString()})
 const product=(await ctx.request(admin,'/api/pos/catalog')).find(p=>p.sku==='WATER-001')
 const sale=async()=>{
  const intent=await ctx.request(admin,'/api/pos/intents',{items:[{productId:product.id,quantity:1}],tenderMode:'CASH',idempotencyKey:randomUUID()},201)
  return ctx.request(admin,`/api/pos/intents/${intent.intent_id}/confirm`,{cashReceivedWon:2000})
 }
 const original=await sale(),other=await sale()
 browser=await chromium.launch({headless:true})
 const context=await browser.newContext({viewport:{width:390,height:900}})
 await context.addCookies([...admin].filter(([,v])=>v).map(([name,value])=>({name,value,url:ctx.base})))
 page=await context.newPage();const errors=[],posts=[]
 page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(10000)
 page.on('request',r=>{if(r.method()==='POST'&&new URL(r.url()).pathname==='/api/refunds')posts.push(r.postDataJSON())})
 await page.goto(ctx.base+'/refunds')
 const lookup=async receipt=>{
  await page.getByLabel('Receipt or online order number',{exact:true}).fill(receipt)
  await page.getByRole('button',{name:'Find sale',exact:true}).click()
  await expect(page.getByRole('group',{name:'Full-sale reversal',exact:true})).toBeVisible()
 }
 const notes=page.getByRole('textbox',{name:'Refund notes',exact:true}),verified=page.getByRole('checkbox',{name:/I verified this receipt/})
 const submit=page.getByRole('button',{name:'Post full refund',exact:true})
 const fill=async()=>{
  // Catalog and sale names may differ in shape; this selects the sole synthetic item.
  await page.getByRole('combobox',{name:/Disposition for/}).selectOption('RESTOCK')
  await page.getByLabel('Refund reason',{exact:true}).selectOption('CUSTOMER_RETURN')
  await notes.fill('Original inspected synthetic return');await verified.check();await expect(submit).toBeEnabled()
 }
 const delay=async status=>{
  let entered
  const started=new Promise(resolve=>{entered=resolve}),gate=new Promise(resolve=>{release=resolve})
  await page.route('**/api/refunds/cash-readiness?*',async route=>{
   entered();await gate
   if(status===503)await route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({ok:false,error:{code:'INTERNAL_ERROR',message:'Synthetic readiness failure'}})})
   else await route.continue()
  },{times:1})
  return {started}
 }
 await lookup(original.receipt_number);await fill()
 let readinessRequests=0
 page.on('request',r=>{if(new URL(r.url()).pathname==='/api/refunds/cash-readiness')readinessRequests++})
 const failed=await delay(503);await submit.click();await failed.started
 await expect(notes).toBeDisabled();await expect(verified).toBeDisabled()
 const item=page.getByRole('combobox',{name:/Disposition for/})
 await expect(item).toBeDisabled()
 // Attempt actual user edits while the GET is held, rather than merely inspect CSS.
 await assert.rejects(()=>notes.fill('Changed while waiting',{timeout:200}),/Timeout/)
 await assert.rejects(()=>verified.uncheck({timeout:200}),/Timeout/)
 await assert.rejects(()=>item.selectOption('WRITE_OFF',{timeout:200}),/Timeout/)
 await expect(notes).toHaveValue('Original inspected synthetic return');await expect(verified).toBeChecked();await expect(item).toHaveValue('RESTOCK')
 // A direct second submit event must also be rejected by the synchronous guard.
 await notes.evaluate(el=>el.form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})))
 assert.equal(readinessRequests,1);assert.equal(posts.length,0)
 release();await expect(notes).toBeEnabled()
 await expect(page.getByText('Cash readiness could not be confirmed. Refresh before proceeding; do not hand over cash.',{exact:true})).toBeVisible()
 assert.equal(posts.length,0);checks.push('Delayed readiness locks notes, disposition and verification; duplicate submit is ignored; failure unlocks without POST')
 await notes.fill('Reviewed changed synthetic return');await item.selectOption('WRITE_OFF');await verified.uncheck()
 await page.getByRole('button',{name:'Check cash readiness',exact:true}).click();await expect(submit).toBeDisabled()
 await verified.check();await expect(submit).toBeEnabled()
 const cancelled=await delay(200);await submit.click();await cancelled.started
 await lookup(other.receipt_number);release()
 await expect(notes).toHaveValue('');assert.equal(posts.length,0)
 checks.push('Changing the selected sale cancels the pending form; delayed completion does not submit the abandoned draft')
 await lookup(original.receipt_number);await fill()
 await notes.fill('Reviewed changed synthetic return');await item.selectOption('WRITE_OFF')
 await page.route('**/api/refunds',async route=>{
  const result=await route.fetch();assert.equal(result.status(),200)
  await route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({ok:false,error:{code:'INTERNAL_ERROR',message:'Synthetic committed response loss'}})})
 },{times:1})
 await submit.click()
 await expect(page.getByRole('button',{name:'Recover refund result',exact:true})).toBeEnabled()
 assert.equal(posts.length,1);assert.equal(posts[0].notes,'Reviewed changed synthetic return');assert.equal(posts[0].verified,true);assert.equal(posts[0].items[0].disposition,'WRITE_OFF')
 await page.getByRole('button',{name:'Recover refund result',exact:true}).click()
 await expect(page.getByRole('heading',{name:'Refund recorded',exact:true})).toBeVisible()
 assert.equal(posts.length,1)
 assert.equal(Number((await ctx.owner.query('select count(*) from private.sale_refunds where sale_id=$1',[original.sale_id])).rows[0].count),1)
 assert.deepEqual(errors,[]);checks.push('Reviewed retry posts the current draft once; committed lost response retains authoritative recovery')
 await page.screenshot({path:dir+'/recovered-390.png',fullPage:true})
 fs.writeFileSync(dir+'/results.json',JSON.stringify({checks,syntheticLocalhostOnly:true},null,2)+'\n')
 console.log(`Refund readiness submit passed: ${checks.length} browser/API regression groups.`)
} catch(e) {fs.writeFileSync(dir+'/failure.txt',e.stack??String(e));if(page)fs.writeFileSync(dir+'/page.txt',await page.locator('body').innerText());console.error(e.message);process.exitCode=1}
finally {release?.();await browser?.close();await ctx?.close()}
