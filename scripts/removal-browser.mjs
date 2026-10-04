import assert from 'node:assert/strict'
import {chromium,expect} from '@playwright/test'
export async function runRemovalBrowser(ctx,{admin,inventory,productId,studentId,studentCode,couponId}){
 const browser=await chromium.launch({headless:true}),contexts=[],pages=[],errors=[],checks=[],dir='.validation/removal'
 let releaseResponse=()=>{}
 async function pageFor(cookies){const context=await browser.newContext({viewport:{width:390,height:844}});contexts.push(context);await context.addCookies([...cookies].filter(([,v])=>v).map(([name,value])=>({name,value,url:ctx.base})));const page=await context.newPage();pages.push(page);page.on('pageerror',e=>errors.push(e.message));return page}
 async function capture(page,name){for(const width of [390,1440]){await page.setViewportSize({width,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'No page overflow');await page.screenshot({path:`${dir}/${name}-${width}.png`,fullPage:true})}}
 async function fill(dialog,code){await dialog.getByLabel('Reason for deletion or restoration',{exact:true}).fill('Synthetic reviewed browser record removal');await dialog.getByLabel('Current Super Admin PIN',{exact:true}).fill(ctx.staffPin);await dialog.locator('input[data-confirmation-text]').fill(code)}
 try{
  const inv=await pageFor(inventory);await inv.goto(ctx.base+'/inventory');await expect(inv.getByRole('heading',{name:'Product register',exact:true})).toBeVisible();await expect(inv.getByRole('button',{name:'Delete product',exact:true})).toHaveCount(0)
  const page=await pageFor(admin),record=(await ctx.owner.query('select sku from public.products where id=$1',[productId])).rows[0]
  await page.goto(ctx.base+'/inventory')
  const row=page.getByRole('row').filter({hasText:record.sku})
  await row.getByRole('button',{name:'Delete product',exact:true}).click()
  let dialog=page.getByRole('alertdialog',{name:'Delete product?',exact:true}),confirm=dialog.getByRole('button',{name:'Delete product',exact:true})
  await expect(dialog.getByRole('button',{name:'Keep record',exact:true})).toBeFocused()
  const description=await dialog.getAttribute('aria-describedby');assert.ok(await page.evaluate(id=>!!document.getElementById(id)?.textContent,description))
  await expect(confirm).toBeDisabled();await fill(dialog,'wrong');await expect(confirm).toBeDisabled()
  let writes=0;page.on('request',r=>{if(new URL(r.url()).pathname==='/api/removals'&&r.method()==='POST')writes++})
  await page.keyboard.press('Escape');await expect(dialog).toHaveCount(0);assert.equal(writes,0)
  await page.clock.install();await row.getByRole('button',{name:'Delete product',exact:true}).click()
  await expect(dialog.getByLabel('Current Super Admin PIN',{exact:true})).toHaveValue('')
  await fill(dialog,record.sku);await page.clock.fastForward(60001);await expect(dialog).toHaveCount(0);assert.equal(writes,0)
  await row.getByRole('button',{name:'Delete product',exact:true}).click();await fill(dialog,record.sku)
  await capture(page,'product-delete-review')
  let savedKey,committed=false;const release=new Promise(resolve=>{releaseResponse=resolve})
  await page.route('**/api/removals',async route=>{
   if(route.request().method()!=='POST')return route.continue()
   savedKey=route.request().postDataJSON().requestKey;const response=await route.fetch();assert.equal(response.status(),200);assert.equal((await response.json()).data.outcome,'COMPLETED');committed=true
   await release;await route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({ok:false,error:{code:'INTERNAL_ERROR',message:'Synthetic lost deletion result'}})})
  },{times:1})
  await confirm.click();await expect.poll(()=>committed).toBe(true)
  await expect(dialog).toHaveAttribute('aria-busy','true');await expect(confirm).toBeDisabled();await page.keyboard.press('Escape');await expect(dialog).toBeVisible()
  await confirm.evaluate(button=>{button.click();button.click()});assert.equal(writes,1)
  releaseResponse();await expect(page.getByRole('region',{name:'Saved deletion action'})).toBeVisible()
  const user=(await ctx.request(admin,'/api/auth/session')).user_id,storageKey=`campuspay:removal-operation:${user}:v1`
  assert.deepEqual(JSON.parse(await page.evaluate(key=>sessionStorage.getItem(key),storageKey)),{kind:'PRODUCT',requestKey:savedKey})
  await page.reload();await page.getByRole('button',{name:'Recover deletion result',exact:true}).click()
  await expect(page.getByText(/Record deleted\. Restore it/)).toBeVisible();await expect(row).toHaveCount(0);assert.equal(writes,1)
  assert.equal(await page.evaluate(key=>sessionStorage.getItem(key),storageKey),null)
  assert.equal(Number((await ctx.owner.query('select count(*) n from private.record_removal_operations where request_key=$1',[savedKey])).rows[0].n),1)
  await page.goto(ctx.base+'/administration')
  const deleted=page.getByRole('region',{name:'Deleted records',exact:true}),deletedRow=deleted.getByRole('row').filter({hasText:record.sku})
  await deleted.getByLabel('Deleted record type',{exact:true}).selectOption('PRODUCT')
  // The newest real removal is on the first page, ahead of older pagination fixtures.
  await deletedRow.getByRole('button',{name:'Restore product',exact:true}).click()
  dialog=page.getByRole('dialog',{name:'Restore product?',exact:true});await fill(dialog,record.sku)
  await dialog.getByRole('button',{name:'Restore product',exact:true}).click();await expect(page.getByText(/Record restored\. Reference:/)).toBeVisible();await expect(deletedRow).toHaveCount(0)
  await capture(page,'product-restored')
  checks.push('Super Admin-only buttons, typed confirmation, cancellation, fresh PIN and one-minute expiry, busy double-submit/Escape guard, original-key recovery after committed/lost response and paged restore work on mobile/desktop')
  await page.goto(ctx.base+'/students');await page.getByLabel('Search students',{exact:true}).fill(studentCode)
  await page.getByRole('button').filter({hasText:studentCode}).click();await page.getByRole('button',{name:'Delete student',exact:true}).click()
  dialog=page.getByRole('alertdialog',{name:'Delete student?',exact:true});await fill(dialog,studentCode)
  await capture(page,'student-delete-review')
  await page.route('**/api/students/roster?**',route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({ok:false,error:{code:'INTERNAL_ERROR',message:'Synthetic directory refresh failure'}})}))
  await dialog.getByRole('button',{name:'Delete student',exact:true}).click()
  await expect(page.getByText(/Record deleted\. Restore it/)).toBeVisible();await expect(page.getByRole('heading',{name:'Select a student',exact:true})).toBeVisible()
  assert.equal((await ctx.owner.query('select active from private.students where id=$1',[studentId])).rows[0].active,false)
  await capture(page,'student-confirmed-refresh-failed');await page.unroute('**/api/students/roster?**')
  await page.goto(ctx.base+'/administration');await deleted.getByLabel('Deleted record type',{exact:true}).selectOption('STUDENT')
  await deleted.getByRole('row').filter({hasText:studentCode}).getByRole('button',{name:'Restore student',exact:true}).click()
  dialog=page.getByRole('dialog',{name:'Restore student?',exact:true});await fill(dialog,studentCode);await dialog.getByRole('button',{name:'Restore student',exact:true}).click();await expect(page.getByText(/Record restored\. Reference:/)).toBeVisible()
  const staffRow=page.getByRole('row').filter({hasText:'1001'});await expect(staffRow.getByRole('button',{name:'Delete staff account',exact:true})).toBeVisible()
  const me=page.getByRole('row').filter({hasText:'Your current account'});await expect(me.getByRole('button',{name:'Delete staff account',exact:true})).toBeDisabled()
  const terminal=page.getByRole('row').filter({hasText:'Your terminal'});await expect(terminal.getByRole('button',{name:'Delete register',exact:true})).toBeDisabled()
  await page.goto(ctx.base+'/coupons')
  const couponRow=page.getByRole('row').filter({hasText:'Synthetic removable coupon'})
  await couponRow.getByRole('button',{name:'Delete coupon',exact:true}).click();dialog=page.getByRole('alertdialog',{name:'Delete coupon?',exact:true});await fill(dialog,couponId)
  await dialog.getByRole('button',{name:'Delete coupon',exact:true}).click();await expect(page.getByText(/Record deleted\. Restore it/)).toBeVisible();await expect(couponRow).toHaveCount(0)
  await capture(page,'coupon-deleted')
  checks.push('Student deletion receipt survives detail unmount and failed directory refresh; restoration is accessible in Staff & registers; current-account/register buttons disabled; coupon deletion refreshes its directory')
  assert.deepEqual(errors,[])
  return checks
 }catch(e){for(let i=0;i<pages.length;i++)await pages[i].screenshot({path:`${dir}/failure-${i}.png`,fullPage:true}).catch(()=>{});throw e}
 finally{releaseResponse();for(const context of contexts)await context.close();await browser.close()}
}
