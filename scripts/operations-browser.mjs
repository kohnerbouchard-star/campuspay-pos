import assert from 'node:assert/strict'
import {chromium,expect} from '@playwright/test'
import fs from 'node:fs'
export async function runOperationsBrowser(ctx,cookies,receipt){
 const browser=await chromium.launch({headless:true}),context=await browser.newContext(),page=await context.newPage()
 const errors=[];page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(15000)
 const dir='.validation/operations',widths=[1440,1024,768,390];let screenshotCount=0
 fs.mkdirSync(dir,{recursive:true})
 await context.addCookies([...cookies].filter(([,v])=>v).map(([name,value])=>({name,value,url:ctx.base})))
 const capture=async(name,verify=async()=>{})=>{for(const width of widths){await page.setViewportSize({width,height:900});await verify();await page.screenshot({path:`${dir}/${name}-${width}.png`,fullPage:true});screenshotCount++;assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'No page overflow')}}
 try{
  await page.goto(ctx.base+'/cash');await expect(page.getByText('No open shift at this terminal.',{exact:true})).toBeVisible();await capture('cash-empty')
  await page.getByLabel('₩10,000 pieces',{exact:true}).fill('1');await page.getByRole('checkbox').check()
  await page.route('**/api/cash/open',async route=>{const committed=await route.fetch();assert.equal(committed.status(),200);await route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({ok:false,error:{code:'INTERNAL_ERROR',message:'Simulated lost response'}})})},{times:1})
  await page.getByRole('button',{name:'Open cash shift',exact:true}).click();await expect(page.getByRole('button',{name:'Recover cash result',exact:true})).toBeVisible()
  await page.reload();await page.getByRole('button',{name:'Recover cash result',exact:true}).click();await expect(page.getByText('Count and close this drawer',{exact:true})).toBeVisible();await capture('cash-open')
  const storage=await page.evaluate(()=>sessionStorage.getItem('campuspay:cash-operation:v1'));assert.equal(storage,null)
  await page.getByLabel('₩10,000 pieces',{exact:true}).fill('1');await page.getByLabel('Close notes and any variance explanation').fill('Actual test count and physical confirmation');await page.getByRole('checkbox').check();await page.getByRole('button',{name:'Confirm drawer close',exact:true}).click();await expect(page.getByText('Drawer closed. The count and variance are recorded.',{exact:true})).toBeVisible();await capture('cash-closed')
  await page.goto(ctx.base+'/refunds');await page.getByLabel('Receipt or online order number').fill(receipt);await page.getByRole('button',{name:'Find sale',exact:true}).click()
  await expect(page.getByText('Verified post-dispatch return',{exact:true})).toBeVisible()
  await capture('inspected-return',async()=>{
   for(const name of ['Return type','Refund reason']){
    const control=page.getByRole('combobox',{name,exact:true})
    await expect(control).toBeVisible();await expect(control).toHaveAccessibleName(name)
    await page.getByLabel(name,{exact:true}).selectOption('CUSTOMER_RETURN');await expect(control).toHaveValue('CUSTOMER_RETURN')
    await control.selectOption('');await expect(control).toHaveAccessibleName(name)
   }
   await expect(page.getByRole('button',{name:'Post inspected return',exact:true})).toBeDisabled()
  })
  await page.getByLabel('Return type',{exact:true}).selectOption('CUSTOMER_RETURN');await page.getByLabel('Disposition for Bottled Water',{exact:true}).selectOption('RESTOCK');await page.getByLabel('Refund reason',{exact:true}).selectOption('CUSTOMER_RETURN');await page.getByLabel('Refund notes',{exact:true}).fill('Customer returned all goods; inspected saleable');await page.getByRole('checkbox').check();await page.getByRole('button',{name:'Post inspected return',exact:true}).click();await expect(page.getByText('Refund recorded. Review the wallet credit and any cash still due below.',{exact:true})).toBeVisible();await capture('return-completed')
  assert.deepEqual(errors,[])
  fs.writeFileSync(dir+'/browser.json',JSON.stringify({widths,screenshotCount,unexpectedBrowserErrors:errors,layoutFindings:[],exactAccessibleNamesVerified:true,liveDataUsed:false},null,2))
 }catch(e){await page.screenshot({path:dir+'/last-failure.png',fullPage:true}).catch(()=>{});throw e}finally{await context.close();await browser.close()}
}
