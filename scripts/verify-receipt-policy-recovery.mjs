#!/usr/bin/env node
// Synthetic localhost-only acceptance. Never uses school credentials or production writes.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { randomUUID } from 'node:crypto'
import { chromium, expect } from '@playwright/test'
import { refundTestContext } from './refund-test-context.mjs'
import { businessDateTimeInput } from '../src/lib/format/business-time.ts'
const directory='.validation/receipt-policy-recovery', checks=[]
fs.mkdirSync(directory,{recursive:true})
let ctx,browser,phase='setup'
try {
  ctx=await refundTestContext(); await ctx.start(false)
  const {owner,request}=ctx, admin=await ctx.login(), inventory=await ctx.login('2001')
  const session=await request(inventory,'/api/auth/session')
  const product=(await request(inventory,'/api/inventory/products')).find(row=>row.sku==='WATER-001')
  assert.ok(product)
  const input={supplierName:'Synthetic Recovery Supplier',supplierInvoice:randomUUID(),purchaseDate:'2026-10-02',shippingWon:0,otherCostsWon:0,discountWon:0,notes:'Synthetic acceptance only',lines:[{productId:product.id,quantity:10,purchaseUnitCostWon:500,expirationDate:null}],idempotencyKey:randomUUID()}
  const stock=async()=>Number((await owner.query('select sum(quantity_remaining) n from private.inventory_lots where product_id=$1',[product.id])).rows[0].n)
  const before=await stock()
  phase='shared receipt field validation'
  const invalid=await request(inventory,'/api/inventory/receipts',{...input,lines:[{...input.lines[0],quantity:0}]},400)
  assert.equal(invalid.code,'BAD_REQUEST')
  assert.deepEqual(invalid.details.fieldErrors,[{field:'lines.0.quantity',message:'Enter a number at least 1.'}])
  assert.equal(JSON.stringify(invalid).includes(input.supplierInvoice),false)
  assert.equal(await stock(),before)
  checks.push('Shared validation identifies the invalid receipt quantity without stock changes or input disclosure')
  phase='actual duplicate-invoice conflict'
  const posted=await request(inventory,'/api/inventory/receipts',input,201)
  assert.equal(await stock(),before+10)
  const conflict=await request(inventory,'/api/inventory/receipts',{...input,idempotencyKey:randomUUID()},409)
  assert.equal(conflict.code,'RECEIPT_INVOICE_EXISTS')
  assert.equal(conflict.message.includes(input.supplierInvoice),false)
  assert.equal(await stock(),before+10)
  await ctx.login('2001',inventory)
  assert.equal((await request(inventory,'/api/inventory/receipts/recover',{idempotencyKey:input.idempotencyKey})).receipt.receipt_id,posted.receipt_id)
  await request(admin,'/api/inventory/receipts/recover',{idempotencyKey:input.idempotencyKey},403)
  checks.push('Actual duplicate invoice returns safe 409 without stock movement; re-login recovery retains operator/register boundary')
  browser=await chromium.launch({headless:true})
  const context=await browser.newContext(),page=await context.newPage(),errors=[]
  page.on('pageerror',error=>errors.push(error.message))
  await context.addCookies([...inventory].filter(([,v])=>v).map(([name,value])=>({name,value,url:ctx.base})))
  const key=`mica-money:pending-stock-receipt:${session.user_id}`
  const receive=async()=>{await page.goto(ctx.base+'/inventory');await page.getByRole('row').filter({hasText:'WATER-001'}).getByRole('button').click();await page.getByRole('button',{name:'Receive Stock',exact:true}).click()}
  await receive()
  let postCount=0
  page.on('request',r=>{if(new URL(r.url()).pathname==='/api/inventory/receipts'&&r.method()==='POST')postCount++})
  phase='reference-only recovery with invalid restored form'
  await page.evaluate(({key,id})=>sessionStorage.setItem(key,JSON.stringify({idempotencyKey:id,lines:'invalid'})),{key,id:input.idempotencyKey})
  await receive()
  await expect(page.getByText('The old form could not be restored.',{exact:false})).toBeVisible()
  await page.getByRole('button',{name:'Check saved stock receipt',exact:true}).click()
  await expect(page.getByText(`Receipt ${posted.receipt_number} posted.`,{exact:false})).toBeVisible()
  assert.equal(await page.evaluate(key=>sessionStorage.getItem(key),key),null)
  assert.equal(postCount,0);assert.equal(await stock(),before+10)
  checks.push('Malformed saved form with a valid reference recovers a committed receipt without POST or duplicate stock')
  phase='missing result is not a cancellation'
  const unknown={...input,supplierInvoice:randomUUID(),idempotencyKey:randomUUID()}
  await page.evaluate(({key,input})=>sessionStorage.setItem(key,JSON.stringify(input)),{key,input:unknown})
  await receive();await page.getByRole('button',{name:'Check saved stock receipt',exact:true}).click()
  await expect(page.getByText('No posted receipt was found for this reference yet.',{exact:false})).toBeVisible()
  assert.equal(postCount,0)
  assert.equal(JSON.parse(await page.evaluate(key=>sessionStorage.getItem(key),key)).idempotencyKey,unknown.idempotencyKey)
  await expect(page.getByRole('button',{name:'Retry original receipt',exact:true})).toBeVisible()
  checks.push('A null status check never submits stock or silently discards the pending reference')
  phase='expired session and forbidden recovery feedback'
  for(const [status,code,expected] of [[401,'SESSION_EXPIRED','Your staff session ended.'],[403,'FORBIDDEN','Use the employee account and original browser/register']]){
    await page.route('**/api/inventory/receipts/recover',r=>r.fulfill({status,contentType:'application/json',body:JSON.stringify({ok:false,error:{code,message:'Safe synthetic denial'}})}),{times:1})
    await page.getByRole('button',{name:'Check saved stock receipt',exact:true}).click()
    await expect(page.getByText(expected,{exact:false})).toBeVisible()
    if(status===401)await expect(page.getByRole('link',{name:'Sign in to recover stock receipt'})).toHaveAttribute('href','/login?expired=1&next=%2Finventory')
    assert.equal(JSON.parse(await page.evaluate(key=>sessionStorage.getItem(key),key)).idempotencyKey,unknown.idempotencyKey)
  }
  for(const width of [1440,390]){await page.setViewportSize({width,height:900});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await page.screenshot({path:`${directory}/receipt-recovery-${width}.png`,fullPage:true})}
  checks.push('Expired/forbidden recovery tells staff the next step while preserving the original reference')
  phase='explicit exact replay and lost committed response'
  await page.getByRole('button',{name:'Check saved stock receipt',exact:true}).click()
  let captured
  await page.route('**/api/inventory/receipts',async route=>{
    captured=route.request().postDataJSON()
    const response=await route.fetch();assert.equal(response.status(),201)
    await route.fulfill({status:500,contentType:'application/json',body:JSON.stringify({ok:false,error:{code:'INTERNAL_ERROR',message:'Request failed'}})})
  },{times:1})
  await page.getByRole('button',{name:'Retry original receipt',exact:true}).click()
  await expect(page.getByText('The server could not confirm this receipt.',{exact:false})).toBeVisible()
  assert.deepEqual(captured,unknown)
  assert.equal(postCount,1);assert.equal(await stock(),before+20)
  await receive();await page.getByRole('button',{name:'Check saved stock receipt',exact:true}).click()
  await expect(page.getByText(/Receipt RCV-.* posted\./)).toBeVisible()
  assert.equal(postCount,1);assert.equal(await stock(),before+20)
  assert.equal(await page.evaluate(key=>sessionStorage.getItem(key),key),null)
  checks.push('Explicit retry uses the exact saved payload/key; committed HTTP 500 survives reload and recovers once')
  await context.close()
  phase='real payment policy validation'
  assert.equal((await request(admin,'/api/pos/payment-policy')).cash_enabled,false)
  for(const [endsAt,text] of [[new Date(Date.now()-3600000).toISOString(),'already passed'],[new Date(Date.now()+48*3600000).toISOString(),'at most 24 hours'],[null,'Korea Standard Time']]){
    const issue=await request(admin,'/api/pos/payment-policy',{cashEnabled:true,eventName:'Synthetic event',endsAt},400)
    assert.equal(issue.details.fieldErrors[0].field,'endsAt');assert.ok(issue.message.includes(text));assert.equal((await request(admin,'/api/pos/payment-policy')).cash_enabled,false)
  }
  const cashier=await ctx.login('1001')
  await request(cashier,'/api/pos/payment-policy',{cashEnabled:true,eventName:'Synthetic event',endsAt:new Date(Date.now()+3600000).toISOString()},403)
  phase='browser payment-policy corrective action'
  const manager=await browser.newContext(),policyPage=await manager.newPage()
  policyPage.on('pageerror',error=>errors.push(error.message))
  await manager.addCookies([...admin].filter(([,v])=>v).map(([name,value])=>({name,value,url:ctx.base})))
  await policyPage.goto(ctx.base+'/settings/payments')
  let policyPosts=0
  policyPage.on('request',r=>{if(new URL(r.url()).pathname==='/api/pos/payment-policy'&&r.method()==='POST')policyPosts++})
  await policyPage.getByLabel('Event name',{exact:true}).fill('Synthetic event')
  await policyPage.getByLabel('Automatically turn off',{exact:true}).fill(businessDateTimeInput(new Date(Date.now()+48*3600000)))
  await policyPage.getByRole('button',{name:'Enable event cash and split payments',exact:true}).click()
  await expect(policyPage.getByRole('alert').getByText('Event cash can be enabled for at most 24 hours.',{exact:false})).toBeVisible()
  await expect(policyPage.getByLabel('Automatically turn off',{exact:true})).toHaveAttribute('aria-invalid','true')
  await expect(policyPage.locator('#event-end-error')).toContainText('at most 24 hours')
  assert.equal(policyPosts,0)
  await policyPage.getByRole('button',{name:'Set end time to one hour from now',exact:true}).click()
  await policyPage.getByRole('button',{name:'Enable event cash and split payments',exact:true}).click()
  await expect(policyPage.getByRole('button',{name:'Turn off cash and split payments',exact:true})).toBeVisible()
  assert.equal(policyPosts,1)
  assert.equal((await request(admin,'/api/pos/payment-policy')).cash_enabled,true)
  await policyPage.getByRole('button',{name:'Turn off cash and split payments',exact:true}).click()
  await expect(policyPage.getByLabel('Automatically turn off',{exact:true})).toBeVisible()
  assert.equal((await request(admin,'/api/pos/payment-policy')).cash_enabled,false)
  await policyPage.screenshot({path:`${directory}/payment-policy.png`,fullPage:true})
  await manager.close();assert.deepEqual(errors,[])
  checks.push('Policy errors explain the unchanged KST/24-hour rules; browser blocks invalid time and one-hour correction works with real API')
  fs.writeFileSync(`${directory}/results.json`,JSON.stringify({checks,liveDataUsed:false,pageErrors:errors},null,2))
  console.log(`Receipt/policy acceptance passed: ${checks.length} groups.`)
}catch(error){fs.writeFileSync(`${directory}/failure.txt`,`Phase: ${phase}\n${error.stack}`);console.error(`Receipt/policy acceptance failed at ${phase}: ${error.message}`);process.exitCode=1}
finally{if(browser)await browser.close();if(ctx)await ctx.close()}
