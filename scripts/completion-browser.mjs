import assert from 'node:assert/strict'
import { chromium } from '@playwright/test'

export async function runCompletionBrowser({base,login,makeRoster,state,newCard,studentPin,request,owner}){
 assert.ok(['localhost','127.0.0.1'].includes(new URL(base).hostname))
 assert.ok(['localhost','127.0.0.1'].includes(owner.connectionParameters.host))
 const browser=await chromium.launch({headless:true}),artifacts=[],pageErrors=[]
 try{
  const untouched=await makeRoster(10,'Browser repeated fixture'),student=await makeRoster(11,'Browser repeated fixture')
  const cookies=await login(),context=await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:'reduce'})
  await context.addCookies([...cookies].filter(([,value])=>value).map(([name,value])=>({name,value,url:base})))
  const page=await context.newPage();page.setDefaultTimeout(15000);page.on('pageerror',error=>pageErrors.push(error.message))
  console.log('Completion browser checkpoint: directory search')
  await page.goto(base+'/students')
  await page.getByLabel('Search students',{exact:true}).fill('Browser repeated fixture')
  await page.getByLabel('Student Year',{exact:true}).selectOption('11')
  console.log('Completion browser checkpoint: select student')
  await page.getByRole('button',{name:new RegExp(student.code)}).click()
  console.log('Completion browser checkpoint: open enrollment')
  await page.getByRole('link',{name:'Complete enrollment',exact:true}).click()
  await page.getByRole('heading',{name:'Complete enrollment',exact:true}).waitFor()
  console.log('Completion browser checkpoint: identity and scanner')
  assert.equal(await page.getByRole('button',{name:'Scan unused card',exact:true}).isDisabled(),true)
  await page.getByRole('checkbox').check()
  await page.getByRole('button',{name:'Scan unused card',exact:true}).click()
  const card=newCard();await page.keyboard.type(card,{delay:8});await page.keyboard.press('Enter')
  await page.getByText('Unused card captured for review. Not issued yet.',{exact:true}).waitFor()
  console.log('Completion browser checkpoint: PIN validation')
  await page.getByLabel('Student PIN',{exact:true}).fill(studentPin)
  await page.getByLabel('Confirm student PIN',{exact:true}).fill(`${studentPin}1`)
  assert.equal(await page.getByRole('button',{name:'Confirm initial card and PIN',exact:true}).isDisabled(),true)
  await page.getByLabel('Confirm student PIN',{exact:true}).fill(studentPin)
  assert.equal(await page.getByLabel('Student PIN',{exact:true}).getAttribute('type'),'password')
  assert.ok((await page.locator('body').innerText()).includes(student.code))
  assert.ok((await page.locator('body').innerText()).includes('Y11'))
  console.log('Completion browser checkpoint: responsive layout')
  for(const width of [1440,390]){
   await page.setViewportSize({width,height:1000})
   const file=`.validation/completion/ready-${width}.png`;await page.screenshot({path:file,fullPage:true});artifacts.push(file)
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true)
   assert.equal(await page.evaluate(()=>[...document.querySelectorAll('input,select,textarea')].filter(e=>e.getClientRects().length&&!e.labels?.length&&!e.getAttribute('aria-label')).length),0)
  }
  let savedRequest,committed=false
  const endpoint=`${base}/api/students/${student.id}/complete-enrollment`
  await page.route(endpoint,async route=>{
   savedRequest=route.request().postDataJSON()
   const response=await route.fetch();assert.equal(response.status(),200);assert.equal((await response.json()).data.outcome,'COMPLETED');committed=true
   await route.abort('failed')
  })
  console.log('Completion browser checkpoint: committed lost response')
  await page.getByRole('button',{name:'Confirm initial card and PIN',exact:true}).click()
  await page.getByText('Enrollment result unknown. Use Recover result before attempting another issuance.',{exact:true}).waitFor()
  assert.equal(committed,true)
  const persisted=await page.evaluate(()=>Object.entries(sessionStorage))
  assert.equal(JSON.stringify(persisted).includes(card),false)
  assert.equal(JSON.stringify(persisted).includes(studentPin),false)
  assert.equal(JSON.stringify(persisted).includes(student.name),false)
  assert.equal(await page.locator('input[type=password]').count(),0)
  await page.unroute(endpoint)
  console.log('Completion browser checkpoint: reload recovery')
  await page.reload()
  await page.getByRole('button',{name:'Recover result',exact:true}).click()
  await page.getByRole('heading',{name:'Enrollment completed',exact:true}).waitFor()
  assert.equal((await state(student)).cards,1)
  assert.equal((await state(untouched)).cards,0)
  assert.equal((await state(student)).wallet.balance_won,0)
  assert.equal(await page.evaluate(id=>sessionStorage.getItem(`campuspay:roster-completion:v1:${id}`),student.id),null)
  const replay=await request(cookies,`/api/students/${student.id}/recover-completion`,{idempotencyKey:savedRequest.idempotencyKey})
  assert.equal(replay.outcome,'COMPLETED')
  for(const width of [1440,390]){await page.setViewportSize({width,height:1000});const file=`.validation/completion/recovered-${width}.png`;await page.screenshot({path:file,fullPage:true});artifacts.push(file)}
  assert.deepEqual(pageErrors,[])
  await context.close()
  return artifacts
 }finally{await browser.close()}
}
