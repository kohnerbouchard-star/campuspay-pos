import assert from 'node:assert/strict'
import fs from 'node:fs'
import { chromium,expect } from '@playwright/test'
export async function fundingBrowser(ctx,cookies,card){
 const browser=await chromium.launch({headless:true}),context=await browser.newContext(),page=await context.newPage(),errors=[]
 const dir='.validation/funding';fs.mkdirSync(dir,{recursive:true});page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(15000)
 await context.addCookies([...cookies].filter(([,v])=>v).map(([name,value])=>({name,value,url:ctx.base})))
 try{
  await page.goto(ctx.base+'/funding');await expect(page.getByRole('button',{name:'Prepare operation',exact:true})).toBeVisible()
  for(const width of [1440,1024,768,390]){await page.setViewportSize({width,height:900});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await page.screenshot({path:`${dir}/funding-${width}.png`})}
  await page.getByRole('button',{name:'+ ₩1,000',exact:true}).click()
  await page.getByLabel('Cash received before change (won)',{exact:true}).fill('5000')
  await page.getByLabel('Source / recipient / bank reference',{exact:true}).fill('Synthetic browser deposit')
  await page.getByLabel('Reason and supporting evidence',{exact:true}).fill('Actual synthetic deposit with change')
  await page.getByRole('button',{name:'Prepare operation',exact:true}).click()
  await expect(page.getByText('Reader ready. Scan the student card to verify the wallet.',{exact:true})).toBeVisible()
  await page.keyboard.type(card,{delay:5});await page.keyboard.press('Enter')
  await expect(page.getByLabel('Student PIN',{exact:true})).toBeVisible();await page.getByLabel('Student PIN',{exact:true}).fill(ctx.pin)
  await page.getByRole('checkbox').check()
  let operation
  await page.route('**/api/funding/confirm',async route=>{const response=await route.fetch();assert.equal(response.status(),200);operation=(await response.json()).data.receipt
   await route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({ok:false,error:{code:'INTERNAL_ERROR',message:'Synthetic response loss'}})})},{times:1})
  await page.getByRole('button',{name:'Record verified operation',exact:true}).click()
  const recover=page.getByRole('button',{name:'Recover funding result',exact:true});await expect(recover).toBeEnabled()
  const stored=JSON.parse(await page.evaluate(()=>sessionStorage.getItem('campuspay:funding-operation:v1')));assert.deepEqual(Object.keys(stored),['requestKey']);assert.equal(stored.requestKey,operation.request_key)
  await page.reload({waitUntil:'domcontentloaded'});await expect(recover).toBeEnabled();await recover.click()
  await expect(page.getByRole('heading',{name:`Recorded receipt ${operation.reference_number}`,exact:true})).toBeVisible()
  await expect(page.getByRole('button',{name:'Prepare operation',exact:true})).toBeVisible()
  assert.equal(await page.evaluate(()=>sessionStorage.getItem('campuspay:funding-operation:v1')),null)
  const n=(await ctx.owner.query('select count(*) from private.funding_operations where request_key=$1',[operation.request_key])).rows[0].count;assert.equal(Number(n),1)
  await page.evaluate(()=>sessionStorage.setItem('campuspay:funding-operation:v1','bad recovery'))
  await page.reload({waitUntil:'domcontentloaded'});await expect(page.getByText('Recovery storage is unavailable or corrupt. Do not start another operation; have the existing request checked.',{exact:true})).toBeVisible()
  await expect(page.getByRole('button',{name:'Prepare operation',exact:true})).toHaveCount(0)
  assert.deepEqual(errors,[])
  return {widths:[1440,1024,768,390],opaqueRecovery:true,singlePostedOperation:true,corruptStorageBlocked:true,unexpectedBrowserErrors:errors}
 }catch(e){await page.screenshot({path:dir+'/failure.png'}).catch(()=>{});throw e}finally{await context.close();await browser.close()}
}
