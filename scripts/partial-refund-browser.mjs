import assert from 'node:assert/strict'
import { chromium,expect } from '@playwright/test'
import fs from 'node:fs'
export async function verifyPartialBrowser(ctx,admin,detail){
 const browser=await chromium.launch({headless:true}),context=await browser.newContext(),page=await context.newPage(),errors=[]
 const dir='.validation/partial-refunds',widths=[1440,1024,768,390];let screenshots=0
 fs.mkdirSync(dir,{recursive:true});page.setDefaultTimeout(15000);page.on('pageerror',e=>errors.push(e.message))
 await context.addCookies([...admin].filter(([,v])=>v).map(([name,value])=>({name,value,url:ctx.base})))
 const capture=async name=>{for(const width of widths){await page.setViewportSize({width,height:950});await page.screenshot({path:`${dir}/${name}-${width}.png`,fullPage:true});screenshots++;assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1))}}
 try{
  await page.goto(ctx.base+'/refunds/items');await page.getByLabel('Receipt or order reference',{exact:true}).fill(detail.receipt_number);await page.getByRole('button',{name:'Load item refund history',exact:true}).click()
  await expect(page.getByRole('heading',{name:'Select inspected goods by original lot',exact:true})).toBeVisible()
  await page.getByLabel('Saleable units — lot 1',{exact:true}).fill('1')
  await page.getByRole('button',{name:'Review inspected refund',exact:true}).click()
  await expect(page.getByRole('region',{name:'Inspected refund review',exact:true})).toBeVisible();await capture('review')
  await page.getByLabel('Item refund reason',{exact:true}).selectOption('CUSTOMER_RETURN')
  await page.getByLabel('Inspection and refund notes',{exact:true}).fill('Synthetic receipt and original stock lot verified')
  await page.getByRole('checkbox',{name:'I verified the receipt, customer, physical goods, original lots and this exact refund.',exact:true}).check()
  let committedId
  await page.route('**/api/refunds/items',async route=>{const r=await route.fetch();assert.equal(r.status(),200);const body=await r.json();assert.equal(body.data.outcome,'COMPLETED');committedId=body.data.refund.refund_id;await route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({ok:false,error:{code:'INTERNAL_ERROR',message:'Synthetic lost response'}})})},{times:1})
  await page.getByRole('button',{name:'Post inspected item refund',exact:true}).click()
  await expect(page.getByRole('alert').filter({hasText:'Item refund result unknown.'})).toBeVisible()
  await expect(page.getByRole('button',{name:'Recover item refund result',exact:true})).toBeEnabled()
  const stored=JSON.parse(await page.evaluate(()=>sessionStorage.getItem('campuspay:refund:v1')))
  assert.deepEqual(Object.keys(stored).sort(),['idempotencyKey','saleId']);assert.equal(stored.saleId,detail.sale_id)
  await page.reload({waitUntil:'commit'});await expect(page.getByRole('button',{name:'Recover item refund result',exact:true})).toBeEnabled()
  let releaseHistory,finishHistory,historyCaptured=false,historyHeld=false
  const historyGate=new Promise(resolve=>{releaseHistory=resolve}),historyDone=new Promise(resolve=>{finishHistory=resolve})
  await page.route('**/api/refunds/items?**',async route=>{
   if(historyHeld){await route.continue();return}historyHeld=true
   try{
    const response=await route.fetch();assert.equal(response.status(),200)
    const body=await response.json(),record=body.data.refunds.find(r=>r.refund_id===committedId)
    assert.equal(record.cash_paid_won,0);historyCaptured=true;await historyGate
    await route.fulfill({response});finishHistory(null)
   }catch(error){finishHistory(error)}
  })
  await page.getByRole('button',{name:'Recover item refund result',exact:true}).click()
  await expect(page.getByText('Refund recorded. Review the wallet credit and any cash still due below.',{exact:true})).toBeVisible()
  await expect(page.getByRole('heading',{name:'Refund recorded',exact:true})).toBeVisible();await capture('recovered')
  await expect.poll(()=>historyCaptured).toBe(true)
  assert.equal(await page.evaluate(()=>sessionStorage.getItem('campuspay:refund:v1')),null)
  const row=(await ctx.owner.query('select count(*) n,min(id::text) id from private.sale_refunds where sale_id=$1',[detail.sale_id])).rows[0]
  assert.equal(Number(row.n),1);assert.equal(row.id,committedId)
  await page.getByRole('button',{name:'Refresh payout status',exact:true}).click()
  await expect(page.getByRole('alert').filter({hasText:'No cash payout is recorded.'})).toBeVisible()
  const handover='Synthetic single cash handover'
  let payouts=0
  page.on('request',request=>{if(request.method()==='POST'&&new URL(request.url()).pathname==='/api/refunds/payout')payouts++})
  await page.route('**/api/refunds/payout',async route=>{
   const response=await route.fetch();assert.equal(response.status(),200)
   await route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({ok:false,error:{code:'INTERNAL_ERROR',message:'Synthetic lost payout response'}})})
  },{times:1})
  await page.getByLabel('Cash handover reference',{exact:true}).fill(handover)
  await page.getByRole('checkbox',{name:'I verified that this exact cash amount was handed over once.',exact:true}).check()
  await page.getByRole('button',{name:'Record cash paid',exact:true}).click()
  await expect(page.getByRole('alert').filter({hasText:'Payout recording is unconfirmed.'})).toBeVisible()
  await page.getByRole('button',{name:'Refresh payout status',exact:true}).click()
  await expect(page.getByText(`Cash payout recorded: ${handover}. Do not pay again.`,{exact:true})).toBeVisible()
  releaseHistory();assert.equal(await historyDone,null)
  await page.getByRole('button',{name:`Open refund ${committedId}`,exact:true}).click()
  await expect(page.getByText(`Cash payout recorded: ${handover}. Do not pay again.`,{exact:true})).toBeVisible()
  await expect(page.getByRole('button',{name:'Record cash paid',exact:true})).toHaveCount(0)
  assert.equal(payouts,1)
  const payoutRows=(await ctx.owner.query('select id,amount_won from private.cash_refund_payouts where refund_id=$1',[committedId])).rows
  assert.equal(payoutRows.length,1)
  const cashEvents=(await ctx.owner.query("select amount_won from private.cash_shift_events where source_type='REFUND_PAYOUT' and source_id=$1",[payoutRows[0].id])).rows
  assert.equal(cashEvents.length,1);assert.equal(Number(cashEvents[0].amount_won),-Number(payoutRows[0].amount_won))
  await page.evaluate(()=>sessionStorage.setItem('campuspay:refund:v1','malformed'))
  await page.reload({waitUntil:'commit'});await expect(page.getByRole('alert').filter({hasText:'Recovery storage is unreadable.'})).toBeVisible()
  assert.deepEqual(errors,[])
  return {widths,screenshots,unexpectedBrowserErrors:errors,oneCommittedRefund:true,opaqueRecovery:true,corruptStorageBlocksWrites:true,recoveredPayoutUpdatesHistoryWithoutSecondHandover:true,delayedUnpaidHistoryCannotDowngradeConfirmedPayout:true,payoutPosts:payouts,payoutRows:payoutRows.length,cashEvents:cashEvents.length}
 }catch(e){await page.screenshot({path:dir+'/last-failure.png',fullPage:true}).catch(()=>{});throw e}
 finally{await context.close();await browser.close()}
}
