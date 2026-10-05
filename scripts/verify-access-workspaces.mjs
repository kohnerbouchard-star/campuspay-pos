#!/usr/bin/env node
// Disposable localhost PostgreSQL, synthetic people, and a local production build only.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { randomUUID } from 'node:crypto'
import { chromium, expect } from '@playwright/test'
import { refundTestContext } from './refund-test-context.mjs'
import { PRESET_DEFAULTS } from '../src/features/auth/capabilities.ts'

const dir='.validation/access-workspaces'
fs.mkdirSync(dir,{recursive:true})
let ctx,browser,phase='setup'
const checks=[],errors=[]
try {
 ctx=await refundTestContext();await ctx.start(false,{administration:true,funding:true})
 const {owner,request,login,staffPin,base}=ctx
 await owner.query('update private.system_settings set administration_enabled=true where singleton')
 const admin=await login()
 const roles={staff:'cashier',manager:'inventory_admin',accountant:'accountant',super_admin:'super_admin'}
 const create=async(preset,code)=>{
  const r=await request(admin,'/api/administration',{action:'CREATE_STAFF',requestKey:randomUUID(),employeeCode:code,displayName:`Access ${code}`,role:roles[preset],preset,newPin:staffPin,confirmationPin:staffPin,adminPin:staffPin,notes:'Synthetic access acceptance employee identity verified',verified:true})
  return r.target_id
 }
 const assign=async(id,preset,permissions)=>{
  const before=await request(admin,`/api/administration/access/${id}`)
  return request(admin,`/api/administration/access/${id}`,{requestKey:randomUUID(),targetId:id,expectedRevision:before.revision,previousPreset:before.preset,previousPermissions:before.permissions,newPreset:preset,permissions,adminPin:staffPin,reason:'Synthetic reviewed customization for access acceptance',confirmed:true})
 }
 const cases=[
  {code:'ACCESS-STAFF',preset:'staff',workspaces:['/register']},
  {code:'ACCESS-MANAGER',preset:'manager',workspaces:['/register','/students','/inventory','/finance']},
  {code:'ACCESS-ACCOUNTANT',preset:'accountant',workspaces:['/register','/students','/finance']},
  {code:'ACCESS-ADMIN',preset:'super_admin',workspaces:['/register','/students','/inventory','/finance','/admin']},
  {code:'ACCESS-ALEX',preset:'staff',permissions:['pos.read','pos.checkout','coupons.redeem','orders.read','orders.fulfill','inventory.read'],workspaces:['/register','/inventory']},
  {code:'ACCESS-FINANCE',preset:'accountant',permissions:[...PRESET_DEFAULTS.accountant,'wallet.approve'],workspaces:['/register','/students','/finance']},
  {code:'ACCESS-STATUS',preset:'manager',permissions:[...PRESET_DEFAULTS.manager,'students.status.manage'],workspaces:['/register','/students','/inventory','/finance']},
  {code:'ACCESS-ADMIN-VIEW',preset:'staff',permissions:['staff.read','terminals.read'],workspaces:['/admin']},
  {code:'ACCESS-VIEW',preset:'staff',permissions:['pos.read','students.read','inventory.read','coupons.read','orders.read'],workspaces:['/register','/students','/inventory']},
 ]
 const footprint=async()=>JSON.stringify((await owner.query(`select
 (select count(*) from private.wallet_ledger) ledger,
 (select sum(balance_won) from private.wallets) balances,
 (select count(*) from private.inventory_movements) inventory,
 (select count(*) from private.sales) sales`)).rows[0])
 const moneyBefore=await footprint()
 phase='creation and explicit access assignments'
 for(const test of cases){
  test.id=await create(test.preset,test.code)
  const initial=await request(admin,`/api/administration/access/${test.id}`)
  assert.deepEqual([...initial.permissions].sort(),[...PRESET_DEFAULTS[test.preset]].sort())
  test.cookies=await login(test.code)
  if(test.permissions){const result=await assign(test.id,test.preset,test.permissions);assert.ok(result.sessions_revoked>=1);await request(test.cookies,'/api/auth/session',undefined,401);test.cookies=await login(test.code)}
  else test.permissions=[...PRESET_DEFAULTS[test.preset]]
  test.session=await request(test.cookies,'/api/auth/session')
  assert.deepEqual([...test.session.permissions].sort(),[...test.permissions].sort())
  assert.equal(test.session.preset,test.preset)
 }
 checks.push('Four presets seed exact stored defaults; custom changes revoke old sessions and resolve exact capabilities after sign-in')
 phase='HTTP and independent database boundaries'
 const sample=(await owner.query('select id from private.students order by student_code limit 1')).rows[0].id
 const routes=[['/api/inventory/products','inventory.read'],['/api/students','students.read'],['/api/orders','orders.read'],['/api/coupons','coupons.read'],['/api/administration','staff.read'],['/api/reports/sales','reports.sales']]
 for(const test of cases){
  for(const [path,cap] of routes)await request(test.cookies,path,undefined,test.permissions.includes(cap)?200:403)
  if(!test.permissions.includes('refunds.issue'))await request(test.cookies,'/api/refunds',{},403)
  if(!test.permissions.includes('pos.checkout'))await request(test.cookies,'/api/pos/intents',{},403)
  if(!test.permissions.includes('staff.access.manage'))await request(test.cookies,`/api/administration/access/${cases[0].id}`,undefined,403)
  if(!test.permissions.includes('wallet.correct'))await request(test.cookies,'/api/funding/prepare',{requestKey:randomUUID(),action:'NONCASH_CREDIT',denominations:[1000],sourceReference:'Synthetic source',notes:'Forged unassigned wallet correction'},403)
  if(!test.permissions.includes('inventory.product.manage'))await request(test.cookies,'/api/management',{kind:'PRODUCT',action:'CREATE_PRODUCT',requestKey:randomUUID(),sku:'DENIED-'+randomUUID().slice(0,8),name:'Denied',category:'QA',sellingPriceWon:1,reorderLevel:0,reason:'Unauthorized synthetic creation request',verified:true},403)
  if(!test.permissions.includes('wallet.read')){
   if(test.permissions.includes('students.read'))assert.ok((await request(test.cookies,'/api/students')).every(s=>s.balance_won===null))
   await assert.rejects(owner.query('select * from api.student_wallet_history($1,$2)',[test.session.session_id,sample]),/FORBIDDEN/)
  }
  if(!test.permissions.includes('staff.access.manage'))await assert.rejects(owner.query('select * from api.employee_access($1,$2)',[test.session.session_id,cases[0].id]),/FORBIDDEN/)
 }
 const cashier=cases[0],manager=cases[1],accountant=cases[2]
 for(const test of [cashier,manager,accountant]){
  const snapshot=await request(admin,`/api/administration/access/${test.id}`)
  await request(test.cookies,`/api/administration/access/${test.id}`,{requestKey:randomUUID(),targetId:test.id,expectedRevision:snapshot.revision,previousPreset:snapshot.preset,previousPermissions:snapshot.permissions,newPreset:'super_admin',permissions:[...PRESET_DEFAULTS.super_admin],adminPin:staffPin,reason:'Unauthorized self promotion must be denied',confirmed:true},403)
 }
 await request(accountant.cookies,'/api/security/step-up',{superAdminEmployeeCode:'9001',superAdminPin:staffPin,purpose:'RESET_STUDENT_PIN',studentId:sample},403)
 checks.push('Direct HTTP and RPC checks reject wallet, product, access and credential escalation; student view redacts unassigned wallet data')
 phase='browser workspace, section and record action matrix'
 browser=await chromium.launch({headless:true})
 const newPage=async cookies=>{
  const context=await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:'reduce'})
  await context.addCookies([...cookies].filter(([,v])=>v).map(([name,value])=>({name,value,url:base})))
  const page=await context.newPage();page.setDefaultTimeout(12000);page.on('pageerror',e=>errors.push(e.message))
  return {context,page}
 }
 const sectionRoutes=[['/pos','pos.read'],['/orders','orders.read'],['/students','students.read'],['/inventory','inventory.read'],['/coupons','coupons.read'],['/refunds','refunds.read'],['/reconciliation','reconciliation.read'],['/reports','reports.sales'],['/administration','staff.read'],['/settings/payments','settings.payments.manage']]
 for(const test of cases){
  phase=`browser ${test.code}`
  const {context,page}=await newPage(test.cookies)
  const start=test.permissions.includes('pos.read')?'/pos':test.permissions.includes('students.read')?'/students':'/administration'
  await page.goto(base+start,{waitUntil:'networkidle'})
  const nav=page.getByRole('complementary',{name:'Staff navigation',exact:true}).getByRole('navigation',{name:'Permitted workspaces'})
  assert.deepEqual((await nav.locator('a').evaluateAll(a=>a.map(x=>x.getAttribute('href')))).sort(),[...test.workspaces].sort())
  for(const [path,cap] of sectionRoutes){
   let requests=0
   const sensitive={'/students':'/api/students','/orders':'/api/orders','/inventory':'/api/inventory/products','/administration':'/api/administration'}[path]
   const listener=r=>{if(sensitive&&new URL(r.url()).pathname===sensitive)requests++}
   page.on('request',listener)
   await page.goto(base+path,{waitUntil:'networkidle'})
   if(test.permissions.includes(cap))assert.equal(new URL(page.url()).pathname,path,`${test.code} permitted ${path}`)
   else {assert.notEqual(new URL(page.url()).pathname,path,`${test.code} denied ${path}`);assert.equal(requests,0,'A denied page never fetches protected records')}
   page.off('request',listener)
  }
  if(test.permissions.includes('students.read')){
   await page.goto(base+'/students',{waitUntil:'networkidle'})
   await page.getByRole('button',{name:/Demo Student/}).first().click()
   const record=page.locator('section[aria-labelledby="student-detail-heading"]')
   assert.equal(await record.getByRole('button',{name:'Add Funds',exact:true}).count(),Number(test.permissions.includes('wallet.fund')))
   assert.equal(await record.getByRole('button',{name:'Wallet History',exact:true}).count(),Number(test.permissions.includes('wallet.read')))
   if(await record.locator('details.record-more').count())await record.getByText('More student actions',{exact:true}).click()
   assert.equal(await record.getByRole('link',{name:'Reset PIN',exact:true}).count(),Number(test.permissions.includes('credentials.reset')))
   assert.equal(await record.getByRole('button',{name:'Manage Status',exact:true}).count(),Number(test.permissions.includes('students.status.manage')))
   assert.equal(await page.getByRole('button',{name:'+ Enroll student',exact:true}).count(),Number(test.permissions.includes('students.enroll')))
   if(test.permissions.includes('wallet.fund')){
    await record.getByRole('button',{name:'Add Funds',exact:true}).click()
    const dialog=page.getByRole('dialog',{name:'Add Funds · Demo Student',exact:true})
    await expect(dialog).toBeVisible();await expect(dialog.getByRole('heading',{name:'Student funding unavailable',exact:true})).toBeVisible()
    await expect(dialog.getByText('Drawer open',{exact:true})).toBeVisible()
    await page.getByRole('button',{name:'Close dialog',exact:true}).click()
   }
  }
  if(test.code==='ACCESS-ADMIN-VIEW'){
   await page.goto(base+'/administration',{waitUntil:'networkidle'})
   await page.getByRole('row').filter({hasText:'ACCESS-STAFF'}).getByRole('button',{name:'Open employee',exact:true}).click()
   await expect(page.getByText('Take payments',{exact:true})).toBeVisible()
   assert.equal(await page.getByRole('button',{name:'Access',exact:true}).count(),0)
   assert.equal(await page.getByRole('button',{name:'Create employee',exact:true}).count(),0)
   assert.equal(await page.getByRole('button',{name:'Manage terminal',exact:true}).count(),0)
   assert.equal(await page.getByRole('button',{name:'Apply verified change',exact:true}).count(),0)
  }
  if(test.code==='ACCESS-VIEW'){
   await page.goto(base+'/pos',{waitUntil:'networkidle'});assert.equal(await page.getByRole('button',{name:/Take payment/}).count(),0);assert.equal(await page.locator('.cart-panel').count(),0)
   await page.goto(base+'/orders',{waitUntil:'networkidle'});assert.equal(await page.getByRole('button',{name:'Start picking',exact:true}).count(),0)
   await page.goto(base+'/inventory',{waitUntil:'networkidle'});await page.getByRole('button',{name:'Bottled Water',exact:true}).click()
   for(const label of ['Receive Stock','Change Price','Adjust Stock','Edit / Archive','Add product'])assert.equal(await page.getByRole('button',{name:label,exact:true}).count(),0)
   await page.goto(base+'/coupons',{waitUntil:'networkidle'});assert.equal(await page.getByRole('button',{name:'Create coupon',exact:true}).count(),0)
  }
  await page.goto(base+start,{waitUntil:'networkidle'});await page.screenshot({path:`${dir}/${test.code}-1440.png`,fullPage:true})
  await context.close()
 }
 checks.push('Nine effective-access profiles verify visible/hidden workspaces, direct-route denial without protected fetches, contextual actions and read-only POS/inventory/orders/coupons')
 phase='access editor dependency, reviewed save and session revocation'
 const {context,page}=await newPage(admin)
 await page.goto(base+'/administration',{waitUntil:'networkidle'})
 const alex=cases.find(c=>c.code==='ACCESS-ALEX')
 await page.getByRole('row').filter({hasText:alex.code}).getByRole('button',{name:'Open employee',exact:true}).click()
 await page.getByRole('button',{name:'Access',exact:true}).click()
 const editor=page.getByRole('dialog',{name:'Employee Access',exact:true})
 const capture=async(state,dialog=editor)=>{
  for(const width of [1440,768,390]){
   await page.setViewportSize({width,height:900})
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1))
   assert.ok(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth+1),'Dialog content stays within its viewport')
   if(state==='customize')assert.ok(await editor.locator('.matrix-table').evaluateAll(tables=>tables.every(el=>el.scrollWidth<=el.clientWidth+1)),'Permission descriptions wrap without horizontal clipping')
   await dialog.evaluate(el=>{el.scrollTop=0})
   await page.screenshot({path:`${dir}/access-${state}-${width}.png`})
  }
  await page.setViewportSize({width:1440,height:1000})
 }
 await expect(editor.getByText(/Customized/)).toBeVisible()
 await editor.getByRole('button',{name:'Customize Access',exact:true}).click()
 await editor.getByRole('checkbox',{name:'Wallets → Operate',exact:true}).check()
 await expect(editor.getByRole('checkbox',{name:'Wallets → View',exact:true})).toBeChecked()
 await expect(editor.getByRole('checkbox',{name:'Student accounts → View',exact:true})).toBeChecked()
 await expect(editor.getByText(/Required access enabled/)).toBeVisible()
 await editor.getByRole('checkbox',{name:'Wallets → View',exact:true}).uncheck()
 await expect(editor.getByRole('checkbox',{name:'Wallets → Operate',exact:true})).not.toBeChecked()
 await editor.getByRole('checkbox',{name:'Wallets → Operate',exact:true}).check()
 await capture('customize')
 // Keep each matrix section reviewable at phone width, including later areas
 // below the dialog's initial scroll position.
 await page.setViewportSize({width:390,height:900})
 for(const workspace of ['Register','Students','Inventory','Finance','Admin']){
  await editor.locator('.access-matrix').getByText(workspace,{exact:true}).scrollIntoViewIfNeeded()
  await page.screenshot({path:`${dir}/access-customize-${workspace.toLowerCase()}-390.png`})
 }
 await page.setViewportSize({width:1440,height:1000})
 await editor.getByRole('button',{name:'Effective Access',exact:true}).click()
 await expect(editor.getByText('Accept a normal cash student deposit',{exact:true})).toBeVisible()
 await editor.getByLabel('Reason for access change',{exact:true}).fill('Synthetic reviewed funding responsibility for Alex')
 await editor.getByLabel('Your current Super Admin PIN',{exact:true}).fill(staffPin)
 await editor.getByRole('button',{name:'Review access changes',exact:true}).click()
 const review=page.getByRole('dialog',{name:'Save employee access?',exact:true})
 await expect(review.getByText(/Active sessions will be revoked/)).toBeVisible()
 await expect(review.getByRole('heading',{name:'Added',exact:true})).toBeVisible()
 await expect(review.getByText('Accept a normal cash student deposit',{exact:true})).toBeVisible()
 await capture('review',review)
 await review.locator('input[data-confirmation-text]').fill(alex.code)
 let savedAccess
 await page.route(`**/api/administration/access/${alex.id}`,async route=>{
  if(route.request().method()!=='POST'){await route.continue();return}
  const response=await route.fetch();assert.equal(response.status(),200)
  savedAccess={requestKey:route.request().postDataJSON().requestKey,...(await response.json()).data}
  await route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({ok:false,error:{code:'INTERNAL_ERROR',message:'Synthetic committed response loss'}})})
 },{times:1})
 const posted=page.waitForResponse(r=>r.url().endsWith(`/api/administration/access/${alex.id}`)&&r.request().method()==='POST')
 await review.getByRole('button',{name:'Save exact access',exact:true}).click()
 assert.equal((await posted).status(),503)
 await expect(editor.getByRole('button',{name:'Recover access result',exact:true})).toBeEnabled()
 assert.equal(savedAccess.outcome,'COMPLETED')
 const recovery=JSON.parse(await page.evaluate(()=>sessionStorage.getItem('campuspay:access-change:v1')))
 assert.deepEqual(recovery,{requestKey:savedAccess.requestKey},'Persist only the opaque request key, never PINs or access snapshots')
 await request(alex.cookies,'/api/auth/session',undefined,401)
 await page.reload({waitUntil:'networkidle'})
 await page.getByRole('row').filter({hasText:alex.code}).getByRole('button',{name:'Open employee',exact:true}).click()
 await page.getByRole('button',{name:'Access',exact:true}).click()
 await editor.getByRole('button',{name:'Recover access result',exact:true}).click()
 await expect(editor.getByText(/Access updated/)).toBeVisible()
 assert.equal(await page.evaluate(()=>sessionStorage.getItem('campuspay:access-change:v1')),null)
 assert.equal(Number((await owner.query('select count(*) from private.staff_access_events where request_key=$1',[savedAccess.requestKey])).rows[0].count),1)
 const newAlex=await login(alex.code),newSession=await request(newAlex,'/api/auth/session')
 assert.ok(newSession.permissions.includes('wallet.fund'));assert.ok(!newSession.permissions.includes('cash.shift.manage'));assert.ok(!newSession.permissions.includes('staff.manage'))
 const audit=await request(admin,`/api/administration/access/${alex.id}`);assert.equal(audit.history[0].reason,'Synthetic reviewed funding responsibility for Alex')
 await editor.getByRole('button',{name:'Effective Access',exact:true}).click()
 for(const width of [1440,768,390]){await page.setViewportSize({width,height:900});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await editor.evaluate(el=>{el.scrollTop=0});await page.screenshot({path:`${dir}/access-editor-${width}.png`})}
 await context.close()
 checks.push('Responsive matrix adds prerequisites, removes dependents, derives Effective Access and reviews before/after; committed response loss recovers after reload with one audit event and immediate session revocation, without unrelated grants')
 assert.equal(await footprint(),moneyBefore,'Access and navigation tests never change balances, stock or sales')
 assert.deepEqual(errors,[])
 fs.writeFileSync(`${dir}/results.json`,JSON.stringify({checks,profiles:cases.map(({code,preset,permissions,workspaces})=>({code,preset,permissions,workspaces})),liveDataUsed:false},null,2))
 console.log(`Access workspace acceptance passed: ${checks.length} groups, ${cases.length} profiles`)
} catch(e){fs.writeFileSync(`${dir}/failure.txt`,`${phase}\n${e.stack}`);console.error(`Access workspace acceptance failed at ${phase}: ${e.message}`);process.exitCode=1}
finally{if(browser)await browser.close();if(ctx)await ctx.close()}
