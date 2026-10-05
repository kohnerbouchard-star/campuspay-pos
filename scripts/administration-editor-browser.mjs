import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import fs from 'node:fs'
import {chromium,expect} from '@playwright/test'

export async function runAdministrationEditorBrowser(ctx,admin){
 const browser=await chromium.launch({headless:true}),contexts=[],pages=[],errors=[],checks=[]
 const dir='.validation/administration-hardening';fs.mkdirSync(dir,{recursive:true})
 const {request,owner,staffPin}=ctx,other=await ctx.login('9101')
 const code='EDIT-'+randomUUID().slice(0,8)
 const created=await request(admin,'/api/administration',{action:'CREATE_STAFF',requestKey:randomUUID(),employeeCode:code,displayName:'Two-operator editor fixture',role:'cashier',preset:'staff',newPin:staffPin,confirmationPin:staffPin,adminPin:staffPin,notes:'Synthetic two-operator browser fixture',verified:true})
 async function refresh(page){
  const response=page.waitForResponse(r=>r.url().includes('/api/administration?')&&r.request().method()==='GET')
  await page.getByRole('button',{name:'Refresh directory',exact:true}).click();assert.equal((await response).status(),200)
 }
 async function select(page,id,kind){
  await page.getByRole('row').filter({hasText:id}).getByRole('button',{name:kind==='STAFF'?'Open employee':'Manage terminal',exact:true}).click()
  const form=page.getByRole('form'),heading=form.getByRole('heading',{level:2})
  await expect(heading).toBeFocused();await expect(heading).toBeInViewport()
  return form
 }
 async function submit(page,expected=200){
  const form=page.getByRole('form')
  await form.getByLabel('Reason and verification evidence',{exact:true}).fill('Two operators verified this deliberate change')
  await form.getByLabel('Your current administrator PIN',{exact:true}).fill(staffPin)
  await form.getByRole('checkbox',{name:'I verified the person or terminal and approve this exact change.',exact:true}).check()
  const response=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/administration'&&r.request().method()==='POST')
  await form.getByRole('button',{name:'Apply verified change',exact:true}).click()
  await confirmReviewedChange(page)
  const result=await response;assert.equal(result.status(),expected)
  const body=await result.json();assert.equal(body.ok,expected===200)
  if(expected!==200){assert.equal(body.error.code,'CONFLICT');await expect(page.getByRole('alert').filter({hasText:'Conflicting operation'})).toBeVisible()}
  else await expect(page.getByRole('form')).toHaveCount(0)
 }
 async function resetAssertions(form){
  await expect(form.getByLabel('Your current administrator PIN',{exact:true})).toHaveValue('')
  await expect(form.getByLabel('Reason and verification evidence',{exact:true})).toHaveValue('')
  await expect(form.getByRole('checkbox',{name:'I verified the person or terminal and approve this exact change.',exact:true})).not.toBeChecked()
 }
 try{
  for(const cookies of [admin,other]){
   const context=await browser.newContext({viewport:{width:390,height:900}});contexts.push(context)
   await context.addCookies([...cookies].filter(([,v])=>v).map(([name,value])=>({name,value,url:ctx.base})))
   const page=await context.newPage();pages.push(page);page.setDefaultTimeout(15000);page.on('pageerror',e=>errors.push(e.message))
   await page.goto(ctx.base+'/administration');await expect(page.getByRole('button',{name:'Create employee',exact:true})).toBeEnabled()
  }
  const [a,b]=pages
  let af=await select(a,code,'STAFF'),bf=await select(b,code,'STAFF')
  await expect(af.getByLabel('Staff role',{exact:true})).toHaveCount(0)
  await bf.getByLabel('Staff display name',{exact:true}).fill('Second operator profile')
  await bf.getByRole('checkbox',{name:/Active — allow/}).uncheck();await submit(b)
  await refresh(a);await expect(a.getByRole('row').filter({hasText:code})).toContainText('Second operator profile')
  // Background refresh does not splice a fresh version into the existing draft.
  await expect(af.getByLabel('Staff role',{exact:true})).toHaveCount(0)
  await expect(af.getByRole('checkbox',{name:/Active — allow/})).toBeChecked()
  await submit(a,409)
  let profile=(await owner.query('select role,active from public.staff_profiles where auth_user_id=$1',[created.target_id])).rows[0]
  assert.deepEqual(profile,{role:'cashier',active:false})
  checks.push('Existing draft retains its old optimistic version and a stale submission is rejected')
  // This is the audited regression: same record ID, newer record props. A
  // fresh editor must reset uncontrolled values AND their version together.
  af=await select(a,code,'STAFF')
  await expect(af.getByLabel('Staff display name',{exact:true})).toHaveValue('Second operator profile')
  await expect(af.getByRole('checkbox',{name:/Active — allow/})).not.toBeChecked();await resetAssertions(af)
  await af.getByLabel('Staff display name',{exact:true}).fill('Updated name without reverting permissions')
  await submit(a)
  profile=(await owner.query('select role,active from public.staff_profiles where auth_user_id=$1',[created.target_id])).rows[0]
  assert.deepEqual(profile,{role:'cashier',active:false})
  checks.push('Reselecting refreshed staff resets fields and acknowledgment; accepted edits preserve the newer profile and active status')
  const idle=await ctx.login('1001'),idleSession=await request(idle,'/api/auth/session')
  const terminal=(await owner.query('select t.id,t.label,t.active from private.terminals t join private.staff_sessions s on s.terminal_id=t.id where s.id=$1',[idleSession.session_id])).rows[0]
  await request(admin,'/api/administration',{action:'UPDATE_TERMINAL',targetId:terminal.id,requestKey:randomUUID(),label:'Original editor terminal',active:true,expectedActive:terminal.active,expectedLabel:terminal.label,adminPin:staffPin,notes:'Synthetic terminal editor baseline',verified:true})
  await refresh(a);await refresh(b)
  af=await select(a,terminal.id,'TERMINAL');bf=await select(b,terminal.id,'TERMINAL')
  await bf.getByLabel('Terminal label',{exact:true}).fill('Second operator terminal')
  await bf.getByRole('checkbox',{name:/Active — allow/}).uncheck();await submit(b)
  await refresh(a);await expect(a.getByRole('row').filter({hasText:terminal.id})).toContainText('Second operator terminal')
  await expect(af.getByLabel('Terminal label',{exact:true})).toHaveValue('Original editor terminal')
  await submit(a,409)
  af=await select(a,terminal.id,'TERMINAL')
  await expect(af.getByLabel('Terminal label',{exact:true})).toHaveValue('Second operator terminal')
  await expect(af.getByRole('checkbox',{name:/Active — allow/})).not.toBeChecked();await resetAssertions(af)
  // Reselecting the same unchanged version is also a new explicit edit session.
  await af.getByLabel('Terminal label',{exact:true}).fill('Discard this unsaved draft')
  af=await select(a,terminal.id,'TERMINAL')
  await expect(af.getByLabel('Terminal label',{exact:true})).toHaveValue('Second operator terminal')
  for(const width of [1440,1024,768,390]){
   await a.setViewportSize({width,height:900})
   await af.getByRole('heading').scrollIntoViewIfNeeded()
   await a.screenshot({path:`${dir}/editor-${width}.png`,fullPage:true})
   assert.ok(await a.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'No horizontal page overflow')
  }
  await af.getByLabel('Terminal label',{exact:true}).fill('Reviewed terminal label');await submit(a)
  assert.deepEqual((await owner.query('select label,active from private.terminals where id=$1',[terminal.id])).rows[0],{label:'Reviewed terminal label',active:false})
  checks.push('Two-operator terminal edits reject stale preconditions, reload newer label/access together and do not restore disabled access')
  checks.push('Explicit reselection resets drafts; opening the editor moves keyboard focus and viewport to its heading')
  assert.deepEqual(errors,[])
  return {checks,widths:[1440,1024,768,390],unexpectedBrowserErrors:errors,liveDataUsed:false}
 }catch(e){for(let i=0;i<pages.length;i++)await pages[i].screenshot({path:`${dir}/editor-failure-${i}.png`,fullPage:true}).catch(()=>{});throw e}
 finally{for(const context of contexts)await context.close();await browser.close()}
}

async function confirmReviewedChange(page) {
 const dialog=page.locator('dialog[open]')
 await expect(dialog).toBeVisible()
 const typed=dialog.locator('input[data-confirmation-text]')
 if(await typed.count())await typed.fill(await typed.getAttribute('data-confirmation-text'))
 await dialog.getByRole('button').filter({hasNotText:/^(Go back|×)$/}).last().click()
}
