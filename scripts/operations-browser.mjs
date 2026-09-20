import assert from 'node:assert/strict'
import {chromium,expect} from '@playwright/test'
import fs from 'node:fs'
export async function runOperationsBrowser(ctx,cookies,receipt){
 const browser=await chromium.launch({headless:true}),context=await browser.newContext(),page=await context.newPage()
 const errors=[],pendingRequests=new Map(),recoveryChecks=[];let phase='setup'
 page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(15000)
 page.on('request',r=>pendingRequests.set(r,new URL(r.url()).pathname))
 for(const event of ['requestfinished','requestfailed'])page.on(event,r=>pendingRequests.delete(r))
 const dir='.validation/operations',widths=[1440,1024,768,390];let screenshotCount=0
 fs.mkdirSync(dir,{recursive:true})
 await context.addCookies([...cookies].filter(([,v])=>v).map(([name,value])=>({name,value,url:ctx.base})))
 const captureCurrent=async(name,width)=>{await page.screenshot({path:`${dir}/${name}-${width}.png`,fullPage:true});screenshotCount++;assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'No page overflow')}
 const capture=async(name,verify=async()=>{})=>{for(const width of widths){await page.setViewportSize({width,height:900});await verify();await captureCurrent(name,width)}}
 const postResponse=path=>page.waitForResponse(r=>new URL(r.url()).pathname===path&&r.request().method()==='POST')
 try{
  await page.goto(ctx.base+'/cash');await expect(page.getByText('No open shift at this terminal.',{exact:true})).toBeVisible();await capture('cash-empty')
  for(const width of widths)for(let attempt=0;attempt<3;attempt++){
   phase=`cash-recovery-${width}-${attempt+1}`
   await page.setViewportSize({width,height:900})
   await expect(page.getByText('No open shift at this terminal.',{exact:true})).toBeVisible()
   const before=Number((await ctx.owner.query('select count(*) from private.cash_shifts')).rows[0].count)
   let committedShift,requestKey
   await page.getByLabel('₩10,000 pieces',{exact:true}).fill('1');await page.getByRole('checkbox').check()
   await page.route('**/api/cash/open',async route=>{
    requestKey=route.request().postDataJSON().requestKey
    const committed=await route.fetch();assert.equal(committed.status(),200)
    const body=await committed.json();assert.equal(body.ok,true);committedShift=body.data.shift_id
    await route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({ok:false,error:{code:'INTERNAL_ERROR',message:'Simulated lost response'}})})
   },{times:1})
   const lost=postResponse('/api/cash/open')
   await page.getByRole('button',{name:'Open cash shift',exact:true}).click()
   assert.equal((await lost).status(),503)
   // Pending recovery UI exists while the original request is still busy.
   // Reload only AFTER the committed-but-lost outcome reaches the application.
   const recovery=page.getByRole('button',{name:'Recover cash result',exact:true})
   await expect(page.getByRole('alert').filter({hasText:'Result unconfirmed. Recover this request before opening or closing another shift.'})).toBeVisible()
   await expect(recovery).toBeEnabled()
   const stored=JSON.parse(await page.evaluate(()=>sessionStorage.getItem('campuspay:cash-operation:v1')))
   assert.deepEqual(stored,{requestKey,operation:'OPEN',shiftId:null});assert.match(requestKey,/^[0-9a-f-]{36}$/)
   phase+= '-reload'
   // The recovery UI and real API result are the readiness condition, not
   // completion of every resource contributing to the browser's load event.
   const navigation=await page.reload({waitUntil:'commit'});assert.equal(navigation.status(),200)
   await expect(recovery).toBeVisible();await expect(recovery).toBeEnabled()
   assert.deepEqual(JSON.parse(await page.evaluate(()=>sessionStorage.getItem('campuspay:cash-operation:v1'))),stored)
   const recoveredResponse=postResponse('/api/cash/recover')
   await recovery.click();const recovered=await recoveredResponse;assert.equal(recovered.status(),200)
   const result=await recovered.json();assert.equal(result.ok,true);assert.equal(result.data.outcome,'COMPLETED');assert.equal(result.data.shift.shift_id,committedShift)
   await expect(page.getByText('Count and close this drawer',{exact:true})).toBeVisible()
   assert.equal(await page.evaluate(()=>sessionStorage.getItem('campuspay:cash-operation:v1')),null)
   const shifts=await ctx.owner.query('select id from private.cash_shifts where opening_key=$1',[requestKey])
   assert.equal(shifts.rowCount,1);assert.equal(shifts.rows[0].id,committedShift)
   assert.equal(Number((await ctx.owner.query('select count(*) from private.cash_shifts')).rows[0].count),before+1)
   if(attempt===0)await captureCurrent('cash-open',width)
   phase+= '-close'
   await page.getByLabel('₩10,000 pieces',{exact:true}).fill('1');await page.getByLabel('Close notes and any variance explanation').fill('Actual test count and physical confirmation');await page.getByRole('checkbox').check()
   const closedResponse=postResponse('/api/cash/close')
   await page.getByRole('button',{name:'Confirm drawer close',exact:true}).click()
   const closed=await closedResponse;assert.equal(closed.status(),200)
   const document=(await closed.json()).data;assert.equal(document.shift_id,committedShift);assert.equal(document.expected_won,10000);assert.equal(document.counted_won,10000);assert.equal(document.variance_won,0)
   await expect(page.getByText('Drawer closed. The count and variance are recorded.',{exact:true})).toBeVisible()
   await expect(page.getByText('No open shift at this terminal.',{exact:true})).toBeVisible()
   assert.equal(Number((await ctx.owner.query('select count(*) from private.cash_shift_closes where shift_id=$1',[committedShift])).rows[0].count),1)
   if(attempt===0)await captureCurrent('cash-closed',width)
   recoveryChecks.push({width,attempt:attempt+1,committedResponseLoss:true,reloadRecoveredSameShift:true,exactlyOneOpening:true,exactlyOneClose:true,varianceWon:0})
  }
  phase='inspected-return'
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
  fs.writeFileSync(dir+'/browser.json',JSON.stringify({widths,screenshotCount,recoveryChecks,unexpectedBrowserErrors:errors,layoutFindings:[],exactAccessibleNamesVerified:true,liveDataUsed:false},null,2))
 }catch(e){fs.writeFileSync(dir+'/navigation-failure.json',JSON.stringify({phase,path:new URL(page.url()).pathname,pendingRequests:[...pendingRequests.values()],completedRecoveryChecks:recoveryChecks,errors},null,2));await page.screenshot({path:dir+'/last-failure.png',fullPage:true,timeout:5000}).catch(()=>{});throw e}finally{await context.close();await browser.close()}
}
