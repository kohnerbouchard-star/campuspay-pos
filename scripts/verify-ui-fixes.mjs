#!/usr/bin/env node
// Real React components in Chromium with synthetic same-origin API responses.
// No application server, credentials, database, school data or external network.
// Native API/SQL authorization and posting recovery run separately in the unchanged harness.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { createServer } from 'node:http'
import { build } from 'vite'
import path from 'node:path'
import { chromium, expect } from '@playwright/test'
import { PRESET_DEFAULTS } from '../src/features/auth/capabilities.ts'

const out='.validation/ui-fixes';fs.mkdirSync(out,{recursive:true})
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`
const rows=Array.from({length:120},(_,i)=>({student_id:id(i+1),student_code:`UI-${String(i+1).padStart(3,'0')}`,display_name:`Synthetic Student ${String(i+1).padStart(3,'0')}`,active:true,card_active:true,pin_set:true,balance_won:0,pin_locked_until:null,created_at:'2026-01-01T00:00:00Z',audit_reference:null,year_group:7,academic_year:'2026',total_count:120}))
const ready={database_enabled:true,cash_enabled:true,drawer_open:true,drawer_assigned:true,student_active:true,card_ready:true,pin_ready:true,pin_locked:false}
const gate=()=>{let resolve;const promise=new Promise(r=>{resolve=r});return {promise,resolve}}
const success=(route,data)=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({ok:true,data})})
const failure=route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({ok:false,error:{code:'UNAVAILABLE',message:'Synthetic readiness/refresh failure'}})})
const checks=[],errors=[];let browser,server,phase='bundle'
try{
 const bundle=await build({configFile:false,envFile:false,logLevel:'error',resolve:{alias:{'@':path.resolve('src')}},define:{'process.env':'{"NODE_ENV":"production"}','process.browser':'true'},oxc:{jsx:{runtime:'automatic'}},build:{write:false,minify:false,lib:{entry:'scripts/ui-fixes-fixture.tsx',formats:['iife'],name:'CampusPayUiFixture'},rolldownOptions:{output:{inlineDynamicImports:true}}}})
 const outputs=(Array.isArray(bundle)?bundle:[bundle]).flatMap(b=>b.output)
 const script=outputs.find(o=>o.type==='chunk'&&o.isEntry)?.code
 assert.ok(script,'Fixture must have one browser entry')
 const css=fs.readFileSync('src/app/globals.css','utf8')+'\n'+fs.readFileSync('src/app/usability.css','utf8')
 server=createServer((req,res)=>{if(req.url==='/fixture.js'){res.setHeader('Content-Type','text/javascript');res.end(script)}else if(req.url==='/fixture.css'){res.setHeader('Content-Type','text/css');res.end(css)}else if(req.url==='/'||req.url?.startsWith('/?')){res.setHeader('Content-Type','text/html');res.end('<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>')}else{res.statusCode=404;res.end()}})
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`
 browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_EXECUTABLE_PATH?{executablePath:process.env.CHROMIUM_EXECUTABLE_PATH}:{})})
 async function session(width=1440){
  const context=await browser.newContext({viewport:{width,height:width===390?844:1000},reducedMotion:'reduce'})
  // Next injects a browser process shim in the real application. This isolated
  // library bundle must supply that same browser environment, not a Node process.
  await context.addInitScript(()=>{Object.defineProperty(globalThis,'process',{value:{env:{NODE_ENV:'production'},browser:true,nextTick:(callback,...args)=>queueMicrotask(()=>callback(...args))},configurable:true})})
  const page=await context.newPage();page.setDefaultTimeout(12000);page.on('pageerror',e=>{errors.push(e.message);console.error('Synthetic fixture browser error:',e.message)});page.on('dialog',d=>d.accept())
  const model={requests:[],getReady:route=>success(route,ready),funding:route=>route.abort('failed'),accessLost:false,directoryFails:false,accessReadFailures:0,
   employee:{user_id:id(500),employee_code:'UI-EMP',display_name:'Synthetic employee',active:true,role:'cashier',has_pin:true,preset:'staff',permissions:[...PRESET_DEFAULTS.staff],revision:1,updated_at:'2026-01-01T00:00:00Z'}}
  await context.route('**/*',async route=>{
   const req=route.request(),url=new URL(req.url())
   if(url.origin!==base)return route.abort('blockedbyclient')
   if(!url.pathname.startsWith('/api/'))return route.continue()
   model.requests.push({method:req.method(),path:url.pathname,query:url.search,body:req.postDataJSON()})
   if(url.pathname==='/api/students/roster'){
    const q=(url.searchParams.get('q')??'').toLowerCase(),year=url.searchParams.get('year'),offset=Number(url.searchParams.get('offset')??0)
    const filtered=rows.filter(r=>(!year||String(r.year_group)===year)&&`${r.display_name} ${r.student_code}`.toLowerCase().includes(q))
    return success(route,filtered.slice(offset,offset+50).map(r=>({...r,total_count:filtered.length})))
   }
   if(/^\/api\/students\/[^/]+\/funding$/.test(url.pathname))return req.method()==='GET'?model.getReady(route,url.pathname):model.funding(route)
   if(url.pathname==='/api/funding/recover')return success(route,{outcome:'CLOSED'})
   if(url.pathname==='/api/administration')return model.directoryFails?failure(route):success(route,{enabled:true,current_terminal_id:id(999),staff:[model.employee],staff_total:1,terminals:[],terminal_total:0})
   if(url.pathname==='/api/administration/access/defaults')return success(route,Object.entries(PRESET_DEFAULTS).map(([preset,permissions])=>({preset,permissions})))
   if(url.pathname===`/api/administration/access/${id(500)}`){
    if(req.method()==='POST'){
     const v=req.postDataJSON();assert.equal(v.targetId,id(500));assert.equal(v.expectedRevision,model.employee.revision)
     model.employee={...model.employee,preset:v.newPreset,permissions:v.permissions,revision:model.employee.revision+1,updated_at:'2026-01-02T00:00:00Z'}
     if(model.accessLost)return route.abort('failed')
     return success(route,{outcome:'COMPLETED',audit_reference:'UI-ACCESS-1',sessions_revoked:1})
    }
    if(model.accessReadFailures>0){model.accessReadFailures--;return failure(route)}
    return success(route,{...model.employee,defaults:PRESET_DEFAULTS[model.employee.preset],history:[]})
   }
   if(url.pathname==='/api/administration/access/recover')return success(route,{outcome:'COMPLETED',audit_reference:'UI-ACCESS-1',sessions_revoked:1})
   throw new Error(`Unexpected synthetic request: ${req.method()} ${url.pathname}`)
  })
  return {context,page,model,go:screen=>page.goto(`${base}/?screen=${screen}`)}
 }
 const mutations=model=>model.requests.filter(r=>r.method!=='GET')
 const openStudent=async(page,code='UI-001')=>{await page.getByLabel('Search students',{exact:true}).fill(code);const button=page.getByRole('row').filter({hasText:code}).getByRole('button');await button.click();return page.getByRole('dialog',{name:/^Student account ·/})}
 const openFunding=async page=>{await page.getByRole('button',{name:'Add Funds',exact:true}).click();return page.getByRole('dialog',{name:/^Add Funds ·/})}
 for(const width of [1440,390]){
  phase=`student panel ${width}`;const {page,context,model,go}=await session(width);await go('students')
  await page.getByLabel('Search students',{exact:true}).fill('Synthetic');await page.getByLabel('Student Year',{exact:true}).selectOption('7')
  await expect(page.getByRole('row').filter({hasText:'UI-001'})).toBeVisible();await page.getByRole('button',{name:'Next',exact:true}).click()
  const row=page.locator(`#student-select-${id(61)}`);await expect(row).toBeEnabled();await row.focus()
  const scroller=page.locator('.student-directory .table-scroll');const before=await scroller.evaluate(n=>({list:n.scrollTop,page:window.scrollY}))
  await page.keyboard.press(width===390?'Space':'Enter')
  const dialog=page.getByRole('dialog',{name:/^Student account · Synthetic Student 061/});await expect(dialog).toBeVisible();await expect(dialog.getByRole('button',{name:'Add Funds',exact:true})).toBeInViewport()
  const box=await dialog.boundingBox();assert.equal(Math.round(box.y),0);assert.equal(Math.round(box.x+box.width),width)
  if(width===390){assert.equal(Math.round(box.x),0);assert.equal(Math.round(box.height),844)}else assert.ok(box.width<width*0.7)
  assert.deepEqual(await scroller.evaluate(n=>({list:n.scrollTop,page:window.scrollY})),before)
  assert.equal(await row.getAttribute('aria-pressed'),'true')
  for(const key of ['Tab','Shift+Tab'])for(let i=0;i<8;i++){await page.keyboard.press(key);assert.ok(await dialog.evaluate(n=>n.contains(document.activeElement)))}
  await page.screenshot({path:`${out}/student-panel-${width}.png`})
  await page.keyboard.press('Escape');await expect(dialog).toHaveCount(0);await expect(row).toBeFocused()
  await expect(page.getByLabel('Search students',{exact:true})).toHaveValue('Synthetic');await expect(page.getByLabel('Student Year',{exact:true})).toHaveValue('7')
  await expect(page.getByText('51–100 of 120',{exact:true})).toBeVisible();assert.deepEqual(await scroller.evaluate(n=>({list:n.scrollTop,page:window.scrollY})),before)
  assert.equal(mutations(model).length,0);await context.close();checks.push(`${width}px keyboard selection, viewport detail, focus trap/return and preserved search/year/page/list/page scroll`)
 }
 phase='read-only student';{
  const {page,context,model,go}=await session();await go('students&readonly=1');const dialog=await openStudent(page)
  await expect(dialog.getByRole('button',{name:'Add Funds',exact:true})).toHaveCount(0);await expect(dialog.getByRole('button',{name:'Wallet History',exact:true})).toHaveCount(0)
  assert.equal(mutations(model).length,0);await context.close();checks.push('Read-only student view exposes neither funding nor wallet controls')
 }
 phase='initial readiness failures, single flight and preserved draft';{
  const {page,context,model,go}=await session();let calls=0,release=gate();model.getReady=async route=>{calls++;if(calls===1)return failure(route);if(calls===2){await release.promise;return failure(route)}return success(route,ready)}
  await go('funding');const prepare=page.getByRole('button',{name:'Prepare operation',exact:true}),retry=page.getByRole('button',{name:'Retry funding readiness',exact:true})
  await expect(retry).toBeEnabled();await expect(prepare).toBeDisabled();await retry.click()
  await expect(page.getByRole('button',{name:'Refresh funding readiness',exact:true})).toBeDisabled()
  // A same-turn double DOM activation cannot create another in-flight GET.
  await page.getByRole('button',{name:'Refresh funding readiness',exact:true}).evaluate(n=>{n.click();n.click()});assert.equal(calls,2)
  release.resolve();await expect(retry).toBeEnabled();await expect(prepare).toBeDisabled();await retry.click();await expect(prepare).toBeEnabled()
  await page.getByLabel('Cash received before change (won)',{exact:true}).fill('10000');await page.getByRole('button',{name:'+ ₩10,000',exact:true}).click()
  await page.getByRole('button',{name:'Refresh funding readiness',exact:true}).click();await expect(prepare).toBeEnabled();await expect(page.getByLabel('Cash received before change (won)',{exact:true})).toHaveValue('10000')
  await expect(page.locator('.selected-total strong')).toHaveText('₩10,000');assert.equal(calls,4);assert.equal(mutations(model).length,0)
  await context.close();checks.push('Initial failure → repeated failure → successful GET-only retry, one in-flight request, no draft reset or financial requests')
 }
 phase='delayed readiness after student change';{
  const {page,context,model,go}=await session();const old=gate(),answered=gate();let a=0,b=0
  model.getReady=async(route,path)=>{if(path.includes(id(1))){a++;await old.promise;try{return await success(route,ready)}catch{}finally{answered.resolve()}}b++;return failure(route)}
  await go('funding');await expect.poll(()=>a).toBe(1);await page.getByRole('button',{name:'Select fixture student B',exact:true}).click();await expect.poll(()=>b).toBe(1)
  await expect(page.getByRole('button',{name:'Retry funding readiness',exact:true})).toBeEnabled();old.resolve();await answered.promise
  await expect(page.getByRole('button',{name:'Prepare operation',exact:true})).toBeDisabled();await expect(page.getByRole('alert')).toContainText('Synthetic readiness/refresh failure')
  model.getReady=route=>success(route,ready);await page.getByRole('button',{name:'Retry funding readiness',exact:true}).click();await expect(page.getByRole('button',{name:'Prepare operation',exact:true})).toBeEnabled()
  assert.equal(mutations(model).length,0);await context.close();checks.push('Late student-A success cannot replace student-B error or enable its deposit')
 }
 phase='late failure cannot poison current readiness';{
  const {page,context,model,go}=await session();const old=gate(),answered=gate();let a=0
  model.getReady=async(route,path)=>{if(path.includes(id(1))){a++;await old.promise;try{return await failure(route)}catch{}finally{answered.resolve()}}return success(route,ready)}
  await go('funding');await expect.poll(()=>a).toBe(1);await page.getByRole('button',{name:'Select fixture student B',exact:true}).click();await expect(page.getByRole('button',{name:'Prepare operation',exact:true})).toBeEnabled()
  old.resolve();await answered.promise;await expect(page.getByRole('alert')).toHaveCount(0);assert.equal(mutations(model).length,0)
  await context.close();checks.push('Late student-A failure cannot invalidate student-B successful readiness')
 }
 phase='student draft and financial recovery';{
  const {page,context,model,go}=await session(390);await go('students');await openStudent(page);let dialog=await openFunding(page)
  await expect(dialog.getByRole('button',{name:'Prepare operation',exact:true})).toBeEnabled()
  await dialog.getByRole('button',{name:'+ ₩10,000',exact:true}).click();await dialog.getByLabel('Cash received before change (won)',{exact:true}).fill('10000')
  await dialog.getByLabel('Source / recipient / bank reference',{exact:true}).fill('Synthetic source');await dialog.getByLabel('Reason and supporting evidence',{exact:true}).fill('Synthetic deposit draft for recovery test')
  await page.keyboard.press('Escape');const warning=page.getByRole('alertdialog',{name:'Discard unsaved student changes?',exact:true});await expect(warning).toBeVisible()
  for(let i=0;i<6;i++){await page.keyboard.press('Tab');assert.ok(await warning.evaluate(n=>n.contains(document.activeElement)))}
  await warning.getByRole('button',{name:'Keep editing',exact:true}).click();await expect(dialog.getByLabel('Cash received before change (won)',{exact:true})).toHaveValue('10000')
  assert.equal(mutations(model).length,0)
  await page.keyboard.press('Escape');await warning.getByRole('button',{name:'Discard draft',exact:true}).click();await expect(dialog).toHaveCount(0)
  dialog=await openFunding(page);await expect(dialog.getByLabel('Cash received before change (won)',{exact:true})).toHaveValue('')
  await expect(dialog.getByRole('button',{name:'Prepare operation',exact:true})).toBeEnabled()
  await dialog.getByRole('button',{name:'+ ₩10,000',exact:true}).click();await dialog.getByLabel('Cash received before change (won)',{exact:true}).fill('10000')
  await dialog.getByLabel('Source / recipient / bank reference',{exact:true}).fill('Synthetic source');await dialog.getByLabel('Reason and supporting evidence',{exact:true}).fill('Synthetic deposit draft for recovery test')
  await dialog.getByRole('button',{name:'Prepare operation',exact:true}).click();await expect(dialog.getByRole('button',{name:'Recover funding result',exact:true})).toBeEnabled()
  const marker=await page.evaluate(()=>sessionStorage.getItem('campuspay:funding-operation:v1'));assert.deepEqual(Object.keys(JSON.parse(marker)),['requestKey']);assert.equal(JSON.parse(marker).requestKey,mutations(model)[0].body.requestKey)
  await page.keyboard.press('Escape');await expect(dialog).toBeVisible();await expect(dialog.getByText(/An operation or recovery check is unresolved/)).toBeVisible()
  assert.equal(await page.locator('dialog:modal').count(),2,'Student directory is inert while recovery is unresolved')
  await page.screenshot({path:`${out}/funding-recovery-mobile.png`})
  await page.reload();await openStudent(page);dialog=await openFunding(page);await expect(dialog.getByRole('button',{name:'Recover funding result',exact:true})).toBeEnabled()
  await dialog.getByRole('button',{name:'Recover funding result',exact:true}).click();await expect(dialog.getByText('No funding operation committed. The old request is closed and cannot run late.',{exact:true})).toBeVisible()
  assert.equal(await page.evaluate(()=>sessionStorage.getItem('campuspay:funding-operation:v1')),null)
  assert.deepEqual(mutations(model).map(r=>r.path),[`/api/students/${id(1)}/funding`,'/api/funding/recover']);assert.equal(mutations(model)[1].body.requestKey,JSON.parse(marker).requestKey)
  await dialog.getByRole('button',{name:'Close dialog',exact:true}).click();await page.getByRole('dialog',{name:/^Student account ·/}).getByRole('button',{name:'Close dialog',exact:true}).click()
  await expect(page.locator(`#student-select-${id(1)}`)).toBeFocused();await context.close();checks.push('Nested focus, explicit draft discard warning, unresolved close guard, opaque reload recovery and original request identity')
 }
 async function editAccess(page){
  await page.getByRole('button',{name:'Open employee',exact:true}).click();await page.getByLabel('Staff display name',{exact:true}).fill('Unrelated unsaved profile name')
  await page.getByLabel('Reason and verification evidence',{exact:true}).fill('Keep this unrelated unsaved profile reason')
  await page.getByRole('button',{name:'Access',exact:true}).click();const editor=page.getByRole('dialog',{name:'Employee Access',exact:true})
  await editor.getByLabel('Preset',{exact:true}).selectOption('manager');await editor.getByRole('button',{name:'Reset to Manager defaults',exact:true}).click()
  await editor.getByLabel('Reason for access change',{exact:true}).fill('Synthetic reviewed permission update')
  await editor.getByLabel('Your current Super Admin PIN',{exact:true}).fill('12345678');await editor.getByRole('button',{name:'Review access changes',exact:true}).click()
  const review=page.getByRole('dialog',{name:'Save employee access?',exact:true});await review.getByRole('textbox',{name:'Type UI-EMP to confirm',exact:true}).fill('UI-EMP');return {editor,review}
 }
 for(const lost of [false,true])for(const refreshFails of [false,true]){
  phase=`employee ${lost?'recovered':'normal'} save / refresh ${refreshFails?'failure':'success'}`
  const {page,context,model,go}=await session();model.accessLost=lost;await go('administration');const {editor,review}=await editAccess(page)
  model.directoryFails=refreshFails
  await review.getByRole('button',{name:'Save exact access',exact:true}).click()
  if(lost){await expect(editor.getByRole('button',{name:'Recover access result',exact:true})).toBeEnabled();await editor.getByRole('button',{name:'Recover access result',exact:true}).click()}
  await expect(editor.getByText(/Access updated\./)).toBeVisible();await expect(editor.getByRole('button',{name:'Close dialog',exact:true})).toBeEnabled();await editor.getByRole('button',{name:'Close dialog',exact:true}).click()
  const summary=page.getByRole('region',{name:'Selected employee access',exact:true})
  if(refreshFails){
   await expect(summary.getByRole('alert')).toContainText('display is stale');await expect(summary.getByText('Current preset: Manager',{exact:true})).toHaveCount(0)
   const count=mutations(model).length;model.directoryFails=false;await summary.getByRole('button',{name:'Retry employee access refresh',exact:true}).click();await expect(summary.getByText('Current preset: Manager',{exact:true})).toBeVisible();assert.equal(mutations(model).length,count)
  }else await expect(summary.getByText('Current preset: Manager',{exact:true})).toBeVisible()
  await expect(page.getByLabel('Staff display name',{exact:true})).toHaveValue('Unrelated unsaved profile name');await expect(page.getByLabel('Reason and verification evidence',{exact:true})).toHaveValue('Keep this unrelated unsaved profile reason')
  assert.equal(mutations(model).filter(r=>r.path===`/api/administration/access/${id(500)}`).length,1)
  assert.equal(mutations(model).filter(r=>r.path==='/api/administration/access/recover').length,lost?1:0)
  assert.equal(await page.evaluate(()=>sessionStorage.getItem('campuspay:access-change:v1')),null)
  await page.screenshot({path:`${out}/employee-${lost?'recovered':'saved'}-${refreshFails?'retried':'refreshed'}.png`});await context.close();checks.push(phase+' preserves profile draft and uses read-only refresh')
 }
 phase='reopening an employee does not clear stale access';{
  const {page,context,model,go}=await session();await go('administration');const {editor,review}=await editAccess(page);model.directoryFails=true
  await review.getByRole('button',{name:'Save exact access',exact:true}).click();await expect(editor.getByRole('button',{name:'Retry employee refresh',exact:true})).toBeEnabled()
  await editor.getByRole('button',{name:'Close dialog',exact:true}).click()
  const summary=page.getByRole('region',{name:'Selected employee access',exact:true});await expect(summary.getByRole('alert')).toContainText('display is stale')
  await page.getByRole('button',{name:'Open employee',exact:true}).click();await expect(summary.getByRole('alert')).toContainText('display is stale');await expect(summary.getByText('Current preset: Staff',{exact:true})).toHaveCount(0)
  const count=mutations(model).length;model.directoryFails=false;await summary.getByRole('button',{name:'Retry employee access refresh',exact:true}).click();await expect(summary.getByText('Current preset: Manager',{exact:true})).toBeVisible();assert.equal(mutations(model).length,count)
  await context.close();checks.push('Reselecting a stale directory record cannot relabel old permissions as current')
 }
 phase='editor refresh failure still notifies parent';{
  const {page,context,model,go}=await session();await go('administration');const {editor,review}=await editAccess(page);model.accessReadFailures=1
  await review.getByRole('button',{name:'Save exact access',exact:true}).click();await expect(editor.getByRole('button',{name:'Retry employee refresh',exact:true})).toBeEnabled()
  assert.ok(model.requests.filter(r=>r.path==='/api/administration').length>=2,'Parent callback ran despite editor GET failure')
  const count=mutations(model).length;await editor.getByRole('button',{name:'Retry employee refresh',exact:true}).click();await expect(editor.getByRole('button',{name:'Retry employee refresh',exact:true})).toHaveCount(0);assert.equal(mutations(model).length,count)
  await context.close();checks.push('Editor GET failure cannot skip parent refresh after confirmed save; safe retry does not resubmit access')
 }
 assert.deepEqual(errors,[])
 fs.writeFileSync(`${out}/results.json`,JSON.stringify({passed:true,checks,browserErrors:errors},null,2));console.log(JSON.stringify({passed:true,checks},null,2))
}catch(error){fs.writeFileSync(`${out}/results.json`,JSON.stringify({passed:false,phase,checks,error:String(error),browserErrors:errors},null,2));console.error('UI fixes regression failed:',phase,error,JSON.stringify({browserErrors:errors}));process.exitCode=1}
finally{await browser?.close();if(server)await new Promise(r=>server.close(r))}
