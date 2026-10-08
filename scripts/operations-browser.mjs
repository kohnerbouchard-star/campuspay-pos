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

export async function runCashEligibilityBrowser(ctx){
 const browser=await chromium.launch({headless:true}),contexts=[],checks=[],errors=[]
 const key='campuspay:cash-operation:v1',posts=[]
 let page,phase='setup',releaseOld,oldDone
 const newPage=async cookies=>{
  const context=await browser.newContext({viewport:{width:390,height:900}});contexts.push(context)
  await context.addCookies([...cookies].filter(([,v])=>v).map(([name,value])=>({name,value,url:ctx.base})))
  const p=await context.newPage();p.setDefaultTimeout(15000);p.on('pageerror',e=>errors.push(e.message))
  p.on('request',r=>{if(r.method()==='POST'&&new URL(r.url()).pathname.startsWith('/api/cash/'))posts.push({path:new URL(r.url()).pathname,body:r.postDataJSON()})})
  return p
 }
 const pending=()=>page.evaluate(k=>sessionStorage.getItem(k),key)
 const fillCount=async()=>{await page.getByLabel('₩1,000 pieces',{exact:true}).fill('1');await page.getByLabel('Close notes and any variance explanation').fill('Verified synthetic physical drawer count');await page.getByRole('checkbox',{name:'I physically counted this drawer and verified these quantities.'}).check()}
 const closeDocument=shiftId=>({shiftId,requestKey:ctx.randomUUID(),counts:{'1000':1},notes:'Verified synthetic physical drawer count',verified:true})
 try{
  const owner=await ctx.login(),opening=await ctx.request(owner,'/api/cash/open',{requestKey:ctx.randomUUID(),counts:{'1000':1},verified:true})
  phase='non-owner'
  const nonOwner=await ctx.login('1001',new Map(owner));page=await newPage(nonOwner);await page.goto(ctx.base+'/cash')
  await expect(page.getByText(/This drawer was opened by another operator/)).toBeVisible()
  await expect(page.getByRole('button',{name:'Confirm drawer close',exact:true})).toHaveCount(0)
  assert.equal(await pending(),null);assert.equal(posts.length,0)
  const denied=closeDocument(opening.shift_id)
  await ctx.request(nonOwner,'/api/cash/close',denied,403)
  const unresolved={requestKey:denied.requestKey,operation:'CLOSE',shiftId:opening.shift_id}
  await ctx.request(nonOwner,'/api/cash/recover',unresolved,403)
  assert.equal(Number((await ctx.owner.query('select count(*) from private.cash_shift_closes where shift_id=$1',[opening.shift_id])).rows[0].count),0)
  checks.push('non-owner has no close form, POST or new browser key; direct close/recovery remain forbidden')
  phase='existing-unresolved'
  await page.evaluate(([k,v])=>sessionStorage.setItem(k,JSON.stringify(v)),[key,unresolved]);await page.reload()
  await page.getByRole('button',{name:'Recover cash result',exact:true}).click()
  await expect(page.locator('p.error-message[role="alert"]')).toHaveText('Recovery could not be confirmed. Reconnect on the original terminal as the original operator.')
  assert.deepEqual(JSON.parse(await pending()),unresolved)
  assert.deepEqual(posts.map(p=>p.path),['/api/cash/recover'])
  checks.push('pre-existing unresolved key is retained after denied recovery; no replacement close is submitted')
  await page.context().close()

  phase='read-only'
  page=await newPage(await ctx.login('DRAWER-VIEW',new Map(owner)));await page.goto(ctx.base+'/cash')
  await expect(page.getByText(/Accountant review view/)).toBeVisible()
  await expect(page.getByRole('button',{name:'Confirm drawer close',exact:true})).toHaveCount(0)
  assert.equal(await pending(),null);assert.equal(posts.length,1)
  checks.push('cash reader receives no close action or request key');await page.context().close()

  phase='wrong-terminal'
  const elsewhere=await ctx.login('DRAWER-OVERRIDE');page=await newPage(elsewhere)
  await page.route('**/api/cash?*',async route=>{
   const response=await route.fetch(),body=await response.json();assert.equal(response.status(),200)
   assert.notEqual(body.data.terminal_id,opening.terminal_id);body.data.current_shift=opening
   await route.fulfill({response,json:body})
  })
  await page.goto(ctx.base+'/cash');await expect(page.getByText('Refresh the cash register. This is not an open drawer at the current terminal.',{exact:true})).toBeVisible()
  await expect(page.getByRole('button',{name:'Confirm drawer close',exact:true})).toHaveCount(0)
  assert.equal(await pending(),null);assert.equal(posts.length,1)
  await ctx.request(elsewhere,'/api/cash/close',closeDocument(opening.shift_id),403)
  checks.push('mismatched terminal snapshot blocks UI; explicit override cannot bypass server terminal binding');await page.context().close()

  phase='owner-stale-refresh'
  const returned=await ctx.login('9001',new Map(owner));page=await newPage(returned);await page.goto(ctx.base+'/cash');await fillCount()
  const submit=page.getByRole('button',{name:'Confirm drawer close',exact:true}),count=page.getByLabel('₩1,000 pieces',{exact:true})
  await expect(submit).toBeEnabled()
  let oldStartedResolve,oldDoneResolve,refreshNumber=0
  const oldStarted=new Promise(resolve=>{oldStartedResolve=resolve})
  oldDone=new Promise(resolve=>{oldDoneResolve=resolve})
  const oldGate=new Promise(resolve=>{releaseOld=resolve})
  const reject=route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({ok:false,error:{code:'INTERNAL_ERROR',message:'Synthetic unavailable snapshot'}})})
  const delayed=async route=>{
   refreshNumber++
   if(refreshNumber===2)return reject(route)
   if(refreshNumber!==1)return route.continue()
   try{const response=await route.fetch();oldStartedResolve();await oldGate;await route.fulfill({response});oldDoneResolve(null)}
   catch(error){oldStartedResolve();oldDoneResolve(error)}
  }
  await page.route('**/api/cash?*',delayed)
  await page.getByRole('button',{name:'Refresh cash register',exact:true}).click();await oldStarted
  await expect(count).toBeDisabled();await expect(count).toHaveValue('1')
  // Dispatch past the disabled controls to verify the handler itself guards storage/POST.
  await count.evaluate(input=>input.closest('form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})))
  assert.equal(await pending(),null);assert.equal(posts.length,1)
  await page.getByRole('button',{name:'Refresh cash register',exact:true}).click()
  await expect(page.locator('p.error-message[role="alert"]')).toHaveText('Cash controls could not be loaded. Verify the migration and connection.')
  releaseOld();assert.equal(await oldDone,null);await expect(count).toBeDisabled()
  await count.evaluate(input=>input.closest('form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})))
  assert.equal(await pending(),null);assert.equal(posts.length,1)
  await page.getByRole('button',{name:'Refresh cash register',exact:true}).click();await expect(submit).toBeEnabled();await expect(count).toHaveValue('1')
  await page.unroute('**/api/cash?*',delayed)
  await expect(page.getByLabel('Close notes and any variance explanation')).toHaveValue('Verified synthetic physical drawer count')
  checks.push('refresh immediately disables counts; late superseded success cannot undo newer failure; no key/POST and draft retained until fresh success')

  phase='pagination-away-and-back'
  const paged=async route=>{const response=await route.fetch(),body=await response.json();body.data.total_closed=100;await route.fulfill({response,json:body})}
  await page.route('**/api/cash?*',paged)
  await page.getByRole('button',{name:'Refresh cash register',exact:true}).click();await expect(submit).toBeEnabled()
  await expect(page.getByRole('button',{name:'Next closes',exact:true})).toBeEnabled();await page.unroute('**/api/cash?*',paged)
  let nextStartedResolve,nextDoneResolve
  const nextStarted=new Promise(resolve=>{nextStartedResolve=resolve}),nextGate=new Promise(resolve=>{releaseOld=resolve})
  oldDone=new Promise(resolve=>{nextDoneResolve=resolve})
  const pagination=async route=>{
   if(new URL(route.request().url()).searchParams.get('offset')!=='50')return reject(route)
   try{const response=await route.fetch();nextStartedResolve();await nextGate;await route.fulfill({response});nextDoneResolve(null)}
   catch(error){nextStartedResolve();nextDoneResolve(error)}
  }
  await page.route('**/api/cash?*',pagination)
  await page.getByRole('button',{name:'Next closes',exact:true}).click();await nextStarted
  await page.getByRole('button',{name:'Previous closes',exact:true}).click()
  await expect(count).toBeDisabled();await expect(count).toHaveValue('1')
  await expect(page.locator('p.error-message[role="alert"]')).toHaveText('Cash controls could not be loaded. Verify the migration and connection.')
  await count.evaluate(input=>input.closest('form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})))
  assert.equal(await pending(),null);assert.equal(posts.length,1)
  releaseOld();assert.equal(await oldDone,null);await expect(count).toBeDisabled()
  await page.unroute('**/api/cash?*',pagination)
  await page.getByRole('button',{name:'Refresh cash register',exact:true}).click();await expect(submit).toBeEnabled()
  checks.push('rapid pagination away/back cannot revalidate cached counts; delayed older response and failed current read create no key or POST')

  phase='committed-close-recovery-with-failed-snapshot'
  await page.route('**/api/cash/close',async route=>{const response=await route.fetch();assert.equal(response.status(),200);await reject(route)},{times:1})
  await submit.click();await expect(page.locator('p.error-message[role="alert"]')).toHaveText('Result unconfirmed. Recover this request before opening or closing another shift.')
  const saved=JSON.parse(await pending());assert.equal(saved.shiftId,opening.shift_id);assert.equal(saved.operation,'CLOSE')
  await page.route('**/api/cash?*',reject);await page.reload()
  await expect(page.locator('p.error-message[role="alert"]')).toHaveText('Cash controls could not be loaded. Verify the migration and connection.')
  assert.deepEqual(JSON.parse(await pending()),saved)
  await page.getByRole('button',{name:'Recover cash result',exact:true}).click()
  await expect(page.getByRole('status').filter({hasText:'The original operation is confirmed.'})).toBeVisible()
  assert.equal(await pending(),null)
  assert.equal(posts.filter(p=>p.path==='/api/cash/close').length,1)
  assert.deepEqual(posts.filter(p=>p.path==='/api/cash/recover').at(-1).body,saved)
  assert.equal(Number((await ctx.owner.query('select count(*) from private.cash_shift_closes where shift_id=$1',[opening.shift_id])).rows[0].count),1)
  checks.push('lost committed close survives reload; original recovery works despite failed snapshot, exactly one close');await page.context().close()

  phase='explicit-override'
  const openingOwner=await ctx.login('9001',new Map(owner)),second=await ctx.request(openingOwner,'/api/cash/open',{requestKey:ctx.randomUUID(),counts:{'1000':1},verified:true})
  const override=await ctx.login('DRAWER-OVERRIDE',new Map(owner)),session=await ctx.request(override,'/api/auth/session')
  assert.equal(session.role,'cashier');assert.ok(session.permissions.includes('cash.drawer.override'));assert.notEqual(session.user_id,second.opened_by)
  page=await newPage(override);await page.goto(ctx.base+'/cash');await fillCount();await page.getByRole('button',{name:'Confirm drawer close',exact:true}).click()
  await expect(page.getByRole('status').filter({hasText:'Drawer closed. The count and variance are recorded.'})).toBeVisible()
  const rows=(await ctx.owner.query('select closed_by,variance_won::text from private.cash_shift_closes where shift_id=$1',[second.shift_id])).rows
  assert.deepEqual(rows,[{closed_by:session.user_id,variance_won:'0'}]);assert.equal(await pending(),null)
  checks.push('ordinary role with explicit override closes another operator drawer at same terminal exactly once')
  assert.deepEqual(errors,[])
  fs.writeFileSync('.validation/operations/eligibility.json',JSON.stringify({checks,unexpectedBrowserErrors:errors,liveDataUsed:false},null,2))
 }catch(e){fs.writeFileSync('.validation/operations/eligibility-failure.json',JSON.stringify({phase,error:e.message,checks,errors},null,2));throw e}
 finally{releaseOld?.();await oldDone;for(const c of contexts)await c.close();await browser.close()}
}
