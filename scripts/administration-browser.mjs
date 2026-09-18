import assert from 'node:assert/strict'
import { randomInt,randomUUID } from 'node:crypto'
import { chromium,expect } from '@playwright/test'
import fs from 'node:fs'
export async function runAdministrationBrowser(ctx,cookies){
 const browser=await chromium.launch({headless:true}),context=await browser.newContext(),page=await context.newPage()
 const dir='.validation/administration',widths=[1440,1024,768,390],errors=[];let screenshots=0
 fs.mkdirSync(dir,{recursive:true});page.setDefaultTimeout(15000);page.on('pageerror',e=>errors.push(e.message))
 await context.addCookies([...cookies].filter(([,v])=>v).map(([name,value])=>({name,value,url:ctx.base})))
 const capture=async name=>{for(const width of widths){await page.setViewportSize({width,height:900});await page.screenshot({path:`${dir}/${name}-${width}.png`,fullPage:true});screenshots++;assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'No page overflow')}}
 async function fillAccount(){
  await page.getByRole('button',{name:'Create named staff account',exact:true}).click()
  await page.getByLabel('Employee code (permanent)',{exact:true}).fill('BROWSER-'+randomUUID().slice(0,8))
  await page.getByLabel('Staff display name',{exact:true}).fill('Verified browser fixture')
  await page.getByLabel('Staff role',{exact:true}).selectOption('cashier')
  const pin=String(randomInt(10000000,100000000))
  await page.getByLabel('New staff PIN',{exact:true}).fill(pin);await page.getByLabel('Confirm new staff PIN',{exact:true}).fill(pin)
  await page.getByLabel('Reason and verification evidence',{exact:true}).fill('Synthetic browser acceptance; verified identity')
  await page.getByLabel('Your current administrator PIN',{exact:true}).fill(ctx.staffPin)
  await page.getByRole('checkbox',{name:'I verified the person or terminal and approve this exact change.',exact:true}).check()
 }
 try{
  await page.goto(ctx.base+'/administration');await expect(page.getByRole('button',{name:'Create named staff account',exact:true})).toBeEnabled();await capture('directory')
  await page.getByRole('button',{name:'Create named staff account',exact:true}).click();await capture('account-form');await page.getByRole('button',{name:'Cancel',exact:true}).click()
  const before=Number((await ctx.owner.query('select count(*) from public.staff_profiles')).rows[0].count)
  await fillAccount()
  await page.route('**/api/administration',async route=>{
   const response=await route.fetch();assert.equal(response.status(),200)
   await route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({ok:false,error:{code:'INTERNAL_ERROR',message:'Simulated lost response'}})})
  },{times:1})
  await page.getByRole('button',{name:'Apply verified change',exact:true}).click()
  await expect(page.getByRole('button',{name:'Recover administrative result',exact:true})).toBeVisible()
  const stored=JSON.parse(await page.evaluate(()=>sessionStorage.getItem('campuspay:administration-operation:v1')))
  assert.deepEqual(Object.keys(stored),['requestKey']);assert.match(stored.requestKey,/^[0-9a-f-]{36}$/)
  await capture('unconfirmed-change');await page.reload()
  await expect(page.getByRole('button',{name:'Create named staff account',exact:true})).toBeDisabled()
  await page.getByRole('button',{name:'Recover administrative result',exact:true}).click()
  await expect(page.getByText(/Change recorded\. 0 sessions signed out\./)).toBeVisible()
  await expect(page.getByRole('button',{name:'Create named staff account',exact:true})).toBeEnabled()
  assert.equal(Number((await ctx.owner.query('select count(*) from public.staff_profiles')).rows[0].count),before+1)
  assert.equal(await page.evaluate(()=>sessionStorage.getItem('campuspay:administration-operation:v1')),null)
  await capture('recovered-change')
  // A refresh failure AFTER a successful mutation must never invite a duplicate.
  await fillAccount()
  await page.route('**/api/administration?**',route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({ok:false,error:{code:'INTERNAL_ERROR',message:'Synthetic directory outage'}})}),{times:1})
  await page.getByRole('button',{name:'Apply verified change',exact:true}).click()
  await expect(page.getByText('The change is confirmed. The directory refresh failed; refresh the directory before making another change.',{exact:true})).toBeVisible()
  await expect(page.getByRole('button',{name:'Recover administrative result',exact:true})).toHaveCount(0)
  assert.equal(Number((await ctx.owner.query('select count(*) from public.staff_profiles')).rows[0].count),before+2)
  await page.getByRole('button',{name:'Refresh directory',exact:true}).click()
  await expect(page.getByRole('button',{name:'Create named staff account',exact:true})).toBeEnabled()
  await page.evaluate(()=>sessionStorage.setItem('campuspay:administration-operation:v1','corrupt pending operation'))
  await page.reload();await expect(page.getByRole('button',{name:'Create named staff account',exact:true})).toBeDisabled()
  await expect(page.getByRole('alert')).toContainText('Recovery storage is unreadable or unavailable')
  assert.deepEqual(errors,[])
  fs.writeFileSync(dir+'/browser.json',JSON.stringify({widths,screenshots,unexpectedBrowserErrors:errors,layoutFindings:[],opaqueRecovery:true,postCommitRefreshFailure:true,corruptStorageBlocksWrites:true,liveDataUsed:false},null,2))
 }catch(e){await page.screenshot({path:dir+'/last-failure.png',fullPage:true}).catch(()=>{});throw e}
 finally{await context.close();await browser.close()}
}
