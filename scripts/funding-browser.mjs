import assert from 'node:assert/strict'
import fs from 'node:fs'
import { chromium,expect } from '@playwright/test'
import { formatWon } from '../src/lib/format/currency.ts'
export async function fundingBrowser(ctx,cookies,card){
 const browser=await chromium.launch({headless:true}),context=await browser.newContext(),page=await context.newPage(),errors=[],frames=[]
 const dir='.validation/funding';fs.mkdirSync(dir,{recursive:true});page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());page.setDefaultTimeout(15000)
 await context.addCookies([...cookies].filter(([,v])=>v).map(([name,value])=>({name,value,url:ctx.base})))
 // Retain only frame equality/length diagnostics, never the reader value.
 page.on('request',request=>{if(new URL(request.url()).pathname==='/api/funding/card'){
  const value=request.postDataJSON()?.cardRead;frames.push({exact:value===card,length:typeof value==='string'?value.length:0})
 }})
 const selected=(await ctx.owner.query("select id,student_code,display_name from private.students where display_name='Synthetic funding student'")).rows[0]
 const before=(await ctx.owner.query('select balance_won from private.wallets where student_id=$1',[selected.id])).rows[0].balance_won
 const posted=[]
 async function verifyReceiptAndHistory(operation,label){
  posted.push(operation.request_key)
  assert.equal(operation.student_code,selected.student_code)
  assert.equal(operation.student_name,selected.display_name)
  assert.equal(operation.wallet_delta_won,1000);assert.equal(operation.cash_delta_won,1000)
  assert.equal(operation.balance_after_won,Number(before)+posted.length*1000)
  const receipt=page.getByRole('region',{name:'Funding receipt',exact:true})
  await expect(receipt.getByRole('heading',{name:`Recorded receipt ${operation.reference_number}`,exact:true})).toBeVisible()
  await expect(receipt).toContainText(`Wallet: ${formatWon(operation.balance_before_won)} → ${formatWon(operation.balance_after_won)}`)
  await receipt.getByRole('heading').evaluate(el=>el.scrollIntoView({block:'start'}))
  await page.screenshot({path:`${dir}/${label}-receipt.png`})
  await page.getByRole('dialog',{name:`Add Funds · ${selected.display_name}`,exact:true}).getByRole('button',{name:'Close dialog',exact:true}).click()
  const detail=page.locator('section[aria-labelledby="student-detail-heading"]')
  await expect(detail.locator('dl > div').filter({has:page.getByText('Wallet balance',{exact:true})}).locator('dd')).toHaveText(formatWon(operation.balance_after_won))
  await detail.evaluate(el=>el.scrollIntoView({block:'start'}))
  await page.screenshot({path:`${dir}/${label}-balance.png`})
  await detail.getByRole('button',{name:'Wallet History',exact:true}).click()
  const history=page.getByRole('dialog',{name:`${selected.display_name} · Wallet history`,exact:true})
  await expect(history.getByText('Current wallet balance',{exact:false})).toContainText(formatWon(operation.balance_after_won))
  const entry=history.getByRole('row').filter({hasText:operation.reference_number})
  await expect(entry).toHaveCount(1)
  await expect(entry.locator('td').nth(1)).toHaveText(formatWon(1000))
  await expect(entry.locator('td').nth(2)).toHaveText(formatWon(operation.balance_after_won))
  await entry.evaluate(el=>el.scrollIntoView({block:'center'}))
  await page.screenshot({path:`${dir}/${label}-history.png`})
  const persisted=(await ctx.owner.query(`select w.balance_won,
   (select count(*) from private.funding_operations where request_key=$2) operations,
   (select count(*) from private.wallet_ledger where id=o.ledger_id and student_id=$1 and amount_won=1000) entries
   from private.wallets w join private.funding_operations o on o.request_key=$2 and o.student_id=w.student_id where w.student_id=$1`,[selected.id,operation.request_key])).rows[0]
  assert.equal(Number(persisted.balance_won),operation.balance_after_won)
  assert.equal(Number(persisted.operations),1);assert.equal(Number(persisted.entries),1)
  await history.getByRole('button',{name:'Close dialog',exact:true}).click()
  await detail.getByRole('button',{name:'Add Funds',exact:true}).click()
 }
 async function openStudent(){await page.getByLabel('Search students',{exact:true}).fill(selected.student_code);await page.getByRole('row').filter({hasText:selected.display_name}).getByRole('button').click();await page.getByRole('button',{name:'Add Funds',exact:true}).click()}
 async function prepare(){
  await expect(page.getByRole('button',{name:'Prepare operation',exact:true})).toBeVisible()
  await page.getByRole('button',{name:'+ ₩1,000',exact:true}).click()
  await page.getByLabel('Cash received before change (won)',{exact:true}).fill('5000')
  await page.getByLabel('Source / recipient / bank reference',{exact:true}).fill('Synthetic browser deposit')
  await page.getByLabel('Reason and supporting evidence',{exact:true}).fill('Actual synthetic deposit with change')
  await page.getByRole('button',{name:'Prepare operation',exact:true}).click()
  await expect(page.getByText('Reader ready. Scan the student card to verify the wallet.',{exact:true})).toBeVisible()
 }
 try{
  await page.goto(ctx.base+'/students');await openStudent();await expect(page.getByRole('button',{name:'Prepare operation',exact:true})).toBeVisible()
  for(const width of [1440,1024,768,390]){await page.setViewportSize({width,height:900});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await page.screenshot({path:`${dir}/funding-${width}.png`})}
  await prepare()
  await expect(page.getByRole('dialog',{name:`Add Funds · ${selected.display_name}`,exact:true})).toBeVisible()
  // A harmless blocked-close warning rerenders the mounted funding screen.
  // Readiness refresh now deliberately disables transaction controls while GET
  // is pending; its read-only/race behavior has separate UI regression coverage.
  // Reproduce callback churn between the prefix and suffix of one frame. The
  // timestamps model a continuous device frame independently of CI scheduling.
  const refreshedScan=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/funding/card').catch(e=>({error:e.message}))
  await page.evaluate(async value=>{
   let tick=performance.now()
   const emit=key=>{const event=new KeyboardEvent('keydown',{key,bubbles:true,cancelable:true});Object.defineProperty(event,'timeStamp',{value:tick++});window.dispatchEvent(event)}
   const funding=[...document.querySelectorAll('dialog')].find(e=>e.getAttribute('aria-label')?.startsWith('Add Funds ·'))
   const close=funding?.querySelector('button[aria-label="Close dialog"]')
   if(!funding||!close||close.disabled)throw new Error('Funding dialog unavailable for reader regression')
   for(const char of value.slice(0,8))emit(char)
   await new Promise((resolve,reject)=>{
    const observer=new MutationObserver(()=>{if(funding.textContent.includes('An operation or recovery check is unresolved.')){observer.disconnect();clearTimeout(timer);resolve()}})
    const timer=setTimeout(()=>{observer.disconnect();reject(new Error('Expected funding-screen rerender did not occur'))},3000)
    observer.observe(document.body,{childList:true,subtree:true});close.click()
   })
   for(const char of value.slice(8))emit(char)
   emit('Enter');emit('Enter')
  },card)
  assert.equal((await refreshedScan).status(),200,'Complete frame must survive a funding-screen rerender')
  await expect(page.getByLabel('Student PIN',{exact:true})).toBeVisible()
  assert.deepEqual(frames,[{exact:true,length:card.length}],'No truncated or duplicate reader request')
  await page.getByRole('button',{name:'Cancel and verify no posting',exact:true}).click()
  await expect(page.getByRole('button',{name:'Prepare operation',exact:true})).toBeVisible()
  // Separately exercise native keyboard input, actual posting and lost response.
  await prepare()
  const nativeScan=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/funding/card').catch(e=>({error:e.message}))
  await page.keyboard.type(card,{delay:5});await page.keyboard.press('Enter')
  assert.equal((await nativeScan).status(),200,'Native reader frame must reach the matching student')
  await expect(page.getByLabel('Student PIN',{exact:true})).toBeVisible();await page.getByLabel('Student PIN',{exact:true}).fill(ctx.pin)
  await page.getByRole('checkbox').check()
  let operation
  await page.route('**/api/funding/confirm',async route=>{const response=await route.fetch();assert.equal(response.status(),200);operation=(await response.json()).data.receipt
   await route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({ok:false,error:{code:'INTERNAL_ERROR',message:'Synthetic response loss'}})})},{times:1})
  await page.getByRole('button',{name:'Record verified operation',exact:true}).click()
  const recover=page.getByRole('button',{name:'Recover funding result',exact:true});await expect(recover).toBeEnabled()
  const stored=JSON.parse(await page.evaluate(()=>sessionStorage.getItem('campuspay:funding-operation:v1')));assert.deepEqual(Object.keys(stored),['requestKey']);assert.equal(stored.requestKey,operation.request_key)
  await page.reload({waitUntil:'domcontentloaded'});await openStudent();await expect(recover).toBeEnabled();await recover.click()
  await expect(page.getByRole('heading',{name:`Recorded receipt ${operation.reference_number}`,exact:true})).toBeVisible()
  await expect(page.getByRole('button',{name:'Prepare operation',exact:true})).toBeVisible()
  assert.equal(await page.evaluate(()=>sessionStorage.getItem('campuspay:funding-operation:v1')),null)
  const n=(await ctx.owner.query('select count(*) from private.funding_operations where request_key=$1',[operation.request_key])).rows[0].count;assert.equal(Number(n),1)
  await verifyReceiptAndHistory(operation,'recovered')
  // A normal successful response must update the same student without a reload,
  // as must recovery. Verify the displayed receipt, balance and journal together.
  await prepare()
  const successfulScan=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/funding/card')
  await page.keyboard.type(card,{delay:5});await page.keyboard.press('Enter')
  assert.equal((await successfulScan).status(),200)
  await page.getByLabel('Student PIN',{exact:true}).fill(ctx.pin)
  await page.getByRole('checkbox').check()
  const confirmed=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/funding/confirm')
  await page.getByRole('button',{name:'Record verified operation',exact:true}).click()
  const response=await confirmed;assert.equal(response.status(),200)
  await verifyReceiptAndHistory((await response.json()).data.receipt,'confirmed')
  assert.equal(new Set(posted).size,2)
  await page.evaluate(()=>sessionStorage.setItem('campuspay:funding-operation:v1','bad recovery'))
  await page.reload({waitUntil:'domcontentloaded'});await openStudent();await expect(page.getByText('Recovery storage is unavailable or corrupt. Do not start another operation; have the existing request checked.',{exact:true})).toBeVisible()
  await expect(page.getByRole('button',{name:'Prepare operation',exact:true})).toHaveCount(0)
  assert.deepEqual(frames,Array.from({length:3},()=>({exact:true,length:card.length})))
  assert.deepEqual(errors,[])
  return {widths:[1440,1024,768,390],opaqueRecovery:true,singlePostedOperation:true,receiptBalanceHistory:{recovered:true,confirmed:true},corruptStorageBlocked:true,rerenderDuringScan:true,exactNativeScan:true,duplicateEnterIgnored:true,frames,unexpectedBrowserErrors:errors}
 }catch(e){fs.writeFileSync(dir+'/reader-diagnostics.json',JSON.stringify({frames,unexpectedBrowserErrors:errors}));await page.screenshot({path:dir+'/failure.png'}).catch(()=>{});throw e}finally{await context.close();await browser.close()}
}
