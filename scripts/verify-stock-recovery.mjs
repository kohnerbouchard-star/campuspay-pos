// Real HTTP/browser + native PostgreSQL, restricted to disposable localhost data.
import assert from 'node:assert/strict'
import { randomUUID, randomBytes } from 'node:crypto'
import fs from 'node:fs'
import pg from 'pg'
import { chromium, expect } from '@playwright/test'
import { verifyStockRecoveryUpgrade } from './stock-recovery-upgrade.mjs'
import { refundTestContext } from './refund-test-context.mjs'
const out='.validation/stock-recovery';fs.mkdirSync(out,{recursive:true});fs.rmSync(out+'/results.json',{force:true})
const checks=[],screenshots=[],native=[],errors=[];let ctx,browser,page,phase='setup'
const waitFor=async fn=>{for(let i=0;i<100;i++){if(await fn())return;await new Promise(r=>setTimeout(r,25))}throw new Error('Controlled overlap did not reach lock')}
try {
 const upgrade=await verifyStockRecoveryUpgrade();fs.writeFileSync(out+'/upgrade.json',JSON.stringify(upgrade,null,2)+'\n');checks.push('Forward upgrade preserves historical rows and exact costing body; migration rollback and pre-upgrade recovery pass')
 ctx=await refundTestContext();await ctx.start(false)
 const admin=await ctx.login(),inventory=await ctx.login('2001'),other=await ctx.login('9101'),reader=await ctx.login('3001')
 const session=await ctx.request(inventory,'/api/auth/session'),adminSession=await ctx.request(admin,'/api/auth/session')
 const product=(await ctx.request(admin,'/api/pos/catalog')).find(x=>x.sku==='WATER-001');assert.ok(product)
 const request=(key=randomUUID(),extra={})=>({productId:product.id,quantityToRemove:1,reasonCode:'DAMAGED',notes:'Synthetic damaged stock recovery',idempotencyKey:key,...extra})
 const recover=(cookies,key,status=200)=>ctx.request(cookies,'/api/inventory/adjustments/recover',{idempotencyKey:key},status)
 const sqlArgs=(s,p)=>[s.session_id,p.productId,p.lotId??null,p.quantityToRemove,p.reasonCode,p.notes,p.idempotencyKey]
 const removeSql='select * from api.remove_stock($1,$2,$3,$4,$5,$6,$7)'
 const recoverSql='select * from api.recover_stock_adjustment($1,$2)'
 const footprint=async key=>{
  const a=(await ctx.owner.query('select id,quantity_removed,total_cost_won from private.stock_adjustments where idempotency_key=$1',[key])).rows
  const m=(await ctx.owner.query("select count(*)::int n,coalesce(sum(quantity_change),0)::int quantity,coalesce(sum(total_cost_won),0)::text cost from private.inventory_movements where source_type='STOCK_ADJUSTMENT' and (idempotency_key=$1 or source_id in(select id from private.stock_adjustments where idempotency_key=$1))",[key])).rows[0]
  const audits=(await ctx.owner.query("select count(*)::int n from private.audit_events where event_type='STOCK_REMOVED' and subject_id in(select id from private.stock_adjustments where idempotency_key=$1)",[key])).rows[0].n
  const closures=(await ctx.owner.query('select count(*)::int n from private.stock_adjustment_closures where idempotency_key=$1',[key])).rows[0].n
  const closureAudits=(await ctx.owner.query("select count(*)::int n from private.audit_events where event_type='STOCK_REMOVAL_REQUEST_CLOSED' and subject_id=$1",[key])).rows[0].n
  return {adjustments:a.length,quantity:a[0]?.quantity_removed??0,cost:String(a[0]?.total_cost_won??0),movements:m.n,movementQuantity:m.quantity,movementCost:m.cost,audits,closures,closureAudits}
 }
 const postedOnce=async(key,quantity=1)=>{const f=await footprint(key);assert.equal(f.adjustments,1);assert.equal(f.quantity,quantity);assert.equal(f.movementQuantity,-quantity);assert.equal(BigInt(f.movementCost),-BigInt(f.cost));assert.equal(f.audits,1);assert.equal(f.closures,0);native.push(f);return f}
 phase='permissions and input'
 await recover(reader,randomUUID(),403);await ctx.request(reader,'/api/inventory/adjustments',request(),403)
 await recover(new Map(),randomUUID(),401)
 await ctx.request(inventory,'/api/inventory/adjustments/recover',{idempotencyKey:randomUUID(),quantity:1},400)
 await ctx.request(inventory,'/api/inventory/adjustments/recover',{idempotencyKey:'bad'},400)
 await ctx.request(inventory,'/api/inventory/adjustments/recover',{idempotencyKey:randomUUID()},403,'https://untrusted.invalid')
 checks.push('Effective permission, authentication, strict input and origin gates')
 phase='same-key replay and terminal binding'
 const p=request(),posted=await ctx.request(inventory,'/api/inventory/adjustments',p,201)
 assert.equal(posted.idempotency_key,p.idempotencyKey)
 assert.deepEqual(await ctx.request(inventory,'/api/inventory/adjustments',p,201),posted)
 for(const change of [{notes:'Changed payload'}, {quantityToRemove:2},{reasonCode:'EXPIRED'},{productId:randomUUID()},{lotId:randomUUID()}])await ctx.request(inventory,'/api/inventory/adjustments',{...p,...change},409)
 await recover(other,p.idempotencyKey,403);await ctx.request(other,'/api/inventory/adjustments',p,403)
 const otherTerminal=await ctx.login('2001');await recover(otherTerminal,p.idempotencyKey,403);await ctx.request(otherTerminal,'/api/inventory/adjustments',p,403)
 await ctx.request(inventory,'/api/auth/logout',{});await ctx.login('2001',inventory)
 const newSession=await ctx.request(inventory,'/api/auth/session');assert.notEqual(newSession.session_id,session.session_id)
 assert.equal((await recover(inventory,p.idempotencyKey)).state,'POSTED')
 assert.deepEqual(await ctx.request(inventory,'/api/inventory/adjustments',p,201),posted);await postedOnce(p.idempotencyKey)
 checks.push('Exact replay, changed-payload rejection, original operator/terminal and new-session recovery')
 phase='atomic closure and grants'
 const closed=randomUUID();assert.equal((await recover(inventory,closed)).state,'CLOSED');assert.equal((await recover(inventory,closed)).state,'CLOSED')
 await ctx.request(inventory,'/api/inventory/adjustments',request(closed),409);await recover(other,closed,403);await recover(otherTerminal,closed,403)
 assert.deepEqual(await footprint(closed),{adjustments:0,quantity:0,cost:'0',movements:0,movementQuantity:0,movementCost:'0',audits:0,closures:1,closureAudits:1})
 await assert.rejects(()=>ctx.owner.query('update private.stock_adjustment_closures set closed_at=now() where idempotency_key=$1',[closed]),/Journal entries cannot be changed; post a correcting transaction/)
 await assert.rejects(()=>ctx.owner.query('delete from private.stock_adjustment_closures where idempotency_key=$1',[closed]),/Journal entries cannot be changed; post a correcting transaction/)
 const runtime=new pg.Client({connectionString:ctx.runtimeUrl});await runtime.connect()
 try {
  for(const sql of ['select * from private.stock_adjustments','select * from private.stock_adjustment_closures','select * from private.inventory_movements','select * from private.audit_events'])await assert.rejects(()=>runtime.query(sql),/permission denied/)
  await assert.rejects(()=>runtime.query('select * from private.remove_stock_costed($1,$2,$3,$4,$5,$6,$7)',sqlArgs(newSession,request())),/permission denied/)
  assert.equal((await runtime.query(recoverSql,[newSession.session_id,p.idempotencyKey])).rows[0].result.state,'POSTED')
 }finally{await runtime.end()}
 assert.equal((await ctx.owner.query("select count(*)::int n from pg_proc p cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where p.oid in('api.remove_stock(uuid,uuid,uuid,integer,text,text,uuid)'::regprocedure,'api.recover_stock_adjustment(uuid,uuid)'::regprocedure,'private.remove_stock_costed(uuid,uuid,uuid,integer,text,text,uuid)'::regprocedure) and a.grantee=0 and a.privilege_type='EXECUTE'")).rows[0].n,0)
 checks.push('Atomic absent-request closure fences late execution, one immutable closure/audit, execute-only runtime grants')
 phase='permission loss'
 await ctx.owner.query('update private.system_settings set administration_enabled=true where singleton')
 const access=(await ctx.owner.query('select * from private.staff_access where user_id=$1',[newSession.user_id])).rows[0]
 await ctx.owner.query("select * from api.change_employee_access($1,$2,$3,$4,$5,$6,'staff',$7,$8,$9,true)",[adminSession.session_id,randomUUID(),newSession.user_id,access.revision,access.preset,access.permissions,['inventory.read'],ctx.staffPinProof(ctx.staffPin),'Synthetic removal capability revocation'])
 await recover(inventory,p.idempotencyKey,401);await ctx.login('2001',inventory);await recover(inventory,p.idempotencyKey,403)
 const revoked=(await ctx.owner.query('select * from private.staff_access where user_id=$1',[newSession.user_id])).rows[0]
 await ctx.owner.query('select * from api.change_employee_access($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,true)',[adminSession.session_id,randomUUID(),newSession.user_id,revoked.revision,revoked.preset,revoked.permissions,access.preset,access.permissions,ctx.staffPinProof(ctx.staffPin),'Restore synthetic fixture permissions'])
 await ctx.login('2001',inventory);const current=await ctx.request(inventory,'/api/auth/session')
 assert.equal((await recover(inventory,p.idempotencyKey)).state,'POSTED');await postedOnce(p.idempotencyKey)
 await ctx.owner.query('update private.system_settings set administration_enabled=false where singleton')
 checks.push('Current permission loss revokes/denies recovery without erasing the original result')
 phase='native controlled races'
 for(const order of ['posting-first','closure-first','same-key-posts']){
  const key=randomUUID(),body=request(key),a=new pg.Client({connectionString:ctx.runtimeUrl}),b=new pg.Client({connectionString:ctx.runtimeUrl});await a.connect();await b.connect()
  try {
   await a.query('begin');const pid=(await b.query('select pg_backend_pid() pid')).rows[0].pid
   if(order==='closure-first')await a.query(recoverSql,[current.session_id,key]);else await a.query(removeSql,sqlArgs(current,body))
   const second=(order==='posting-first'?b.query(recoverSql,[current.session_id,key]):b.query(removeSql,sqlArgs(current,body))).then(value=>({value}),error=>({error}))
   await waitFor(async()=> (await ctx.owner.query("select wait_event_type='Lock' waiting from pg_stat_activity where pid=$1",[pid])).rows[0]?.waiting)
   await a.query('commit');const outcome=await second
   if(order==='closure-first'){assert.match(outcome.error?.message??'',/CONFLICT/);assert.equal((await footprint(key)).adjustments,0);assert.equal((await footprint(key)).closureAudits,1)}
   else {assert.ok(outcome.value);await postedOnce(key);if(order==='posting-first')assert.equal(outcome.value.rows[0].result.state,'POSTED')}
  }finally{await a.end();await b.end()}
 }
 checks.push('Three independent-connection controlled overlaps: post/recover, close/late-post, same-key posts')
 phase='multi-lot costing and audit rollback'
 const costProduct=(await ctx.owner.query("insert into public.products(sku,name,category,selling_price_won,created_by) values($1,'Synthetic recovery costing','Synthetic',1000,$2) returning id",['RECOVERY-'+randomBytes(4).toString('hex'),adminSession.user_id])).rows[0].id
 for(const cost of [101,203])await ctx.request(admin,'/api/inventory/receipts',{supplierName:'Synthetic',supplierInvoice:'REC-'+randomUUID(),purchaseDate:'2026-10-07',shippingWon:0,otherCostsWon:0,discountWon:0,lines:[{productId:costProduct,quantity:2,purchaseUnitCostWon:cost}],idempotencyKey:randomUUID()},201)
 const multi=request(randomUUID(),{productId:costProduct,quantityToRemove:3});await ctx.request(admin,'/api/inventory/adjustments',multi,201)
 const mf=await postedOnce(multi.idempotencyKey,3);assert.equal(mf.movements,2);assert.equal(mf.cost,'405')
 const failed=request();const stockBefore=(await ctx.owner.query('select sum(quantity_remaining)::int n from private.inventory_lots where product_id=$1',[product.id])).rows[0].n
 await ctx.owner.query("create function private.synthetic_reject_stock_audit() returns trigger language plpgsql as $$ begin if new.event_type='STOCK_REMOVED' then raise exception 'SYNTHETIC_AUDIT_FAILURE'; end if; return new; end $$; create trigger synthetic_stock_audit_failure before insert on private.audit_events for each row execute function private.synthetic_reject_stock_audit()")
 try {await ctx.request(admin,'/api/inventory/adjustments',failed,500)}finally{await ctx.owner.query('drop trigger synthetic_stock_audit_failure on private.audit_events; drop function private.synthetic_reject_stock_audit()')}
 assert.equal((await footprint(failed.idempotencyKey)).adjustments,0);assert.equal((await ctx.owner.query('select sum(quantity_remaining)::int n from private.inventory_lots where product_id=$1',[product.id])).rows[0].n,stockBefore)
 checks.push('Multi-lot FIFO costing remains exact; a late audit failure rolls back stock, movements and adjustment')
 phase='browser setup'
 browser=await chromium.launch({headless:true})
 const cookieRows=cookies=>[...cookies].filter(([,v])=>v).map(([name,value])=>({name,value,url:ctx.base}))
 const newContext=async(width=1440)=>{const c=await browser.newContext({viewport:{width,height:width===390?844:1000},reducedMotion:'reduce'});await c.addCookies(cookieRows(admin));await c.route('**/*',r=>new URL(r.request().url()).origin===ctx.base?r.continue():r.abort('blockedbyclient'));return c}
 const newPage=async c=>{const p=await c.newPage();p.setDefaultTimeout(15000);p.on('pageerror',e=>errors.push(e.message));return p}
 const open=async p=>{await p.goto(ctx.base+'/inventory');await p.getByRole('button',{name:'Recover stock removal',exact:true}).click()}
 const fill=async p=>{await p.locator('select').first().selectOption(product.id);await p.locator('textarea').fill('Synthetic damaged unit — immutable submission');await p.getByRole('button',{name:'Review stock removal',exact:true}).click();await expect(p.getByRole('dialog',{name:'Confirm stock removal',exact:true})).toBeVisible()}
 const confirm=p=>p.getByRole('button',{name:'Confirm removal',exact:true}).click()
 const pendingView=async p=>{await expect(p.getByRole('heading',{name:'Resolve previous stock removal',exact:true})).toBeVisible();await expect(p.locator('textarea')).toBeDisabled();await expect(p.getByRole('button',{name:'Review stock removal',exact:true})).toBeDisabled()}
 const storageKey=`campuspay:stock-adjustment:v1:${adminSession.user_id}`
 const saved=p=>p.evaluate(k=>localStorage.getItem(k),storageKey)
 const screenshot=async(p,name)=>{assert.ok(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));if(name.startsWith('confirmation')){const box=await p.getByRole('dialog').boundingBox();assert.ok(box.y>=0&&box.y+box.height<=p.viewportSize().height,'Confirmation fits actual viewport')}await p.screenshot({path:out+'/'+name,fullPage:!name.startsWith('confirmation')});screenshots.push(name)}
 const postsFor=p=>{const posts=[];p.on('request',r=>{if(r.method()==='POST'&&new URL(r.url()).pathname==='/api/inventory/adjustments')posts.push(r.postDataJSON())});return posts}
 for(const width of [1440,390]){
  phase=`browser lost response/reload/reauth ${width}`
  const c=await newContext(width);page=await newPage(c);const posts=postsFor(page)
  await open(page);await fill(page);await screenshot(page,`confirmation-${width}.png`)
  await page.getByRole('button',{name:'Cancel',exact:true}).click();assert.equal(posts.length,0)
  await page.getByRole('button',{name:'Review stock removal',exact:true}).click();await page.keyboard.press('Escape');assert.equal(posts.length,0)
  await page.getByRole('button',{name:'Review stock removal',exact:true}).click()
  await page.route('**/api/inventory/adjustments',async r=>{const response=await r.fetch();assert.equal(response.status(),201);await r.abort('failed')},{times:1})
  await confirm(page);await pendingView(page);await expect(page.getByText(/^The removal result is not confirmed/)).toBeVisible();assert.equal(posts.length,1);const key=posts[0].idempotencyKey
  assert.equal(await saved(page),key);await postedOnce(key);await screenshot(page,`unknown-${width}.png`)
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await page.keyboard.press('Escape');await page.getByRole('button',{name:'Back to products',exact:true}).click()
  await page.getByRole('button',{name:product.name,exact:true}).click();await page.locator('summary').filter({hasText:/^More$/}).click();await page.getByRole('button',{name:'Adjust Stock',exact:true}).click();await pendingView(page)
  await page.reload();await page.getByRole('button',{name:'Recover stock removal',exact:true}).click();await pendingView(page)
  await ctx.request(admin,'/api/auth/logout',{});await ctx.login('9001',admin);await c.addCookies(cookieRows(admin))
  await open(page);await pendingView(page);assert.equal(await saved(page),key)
  await page.route('**/api/inventory/adjustments/recover',r=>r.fulfill({status:403,contentType:'application/json',body:JSON.stringify({ok:false,error:{code:'FORBIDDEN',message:'Permission denied'}})}),{times:1})
  await page.getByRole('button',{name:'Recover original removal',exact:true}).click();await expect(page.getByText(/Recovery is not confirmed/)).toBeVisible();assert.equal(await saved(page),key)
  await page.route('**/api/inventory/adjustments/recover',r=>r.fulfill({status:200,contentType:'application/json',body:JSON.stringify({ok:true,data:{state:'CLOSED',idempotency_key:randomUUID()}})}),{times:1})
  await page.getByRole('button',{name:'Recover original removal',exact:true}).click();await expect(page.getByText(/Recovery is not confirmed/)).toBeVisible();assert.equal(await saved(page),key)
  await page.getByRole('button',{name:'Recover original removal',exact:true}).click();await expect(page.getByRole('status').filter({hasText:'original removal is recorded once'})).toBeVisible()
  assert.equal(await saved(page),null);assert.equal(posts.length,1);await postedOnce(key);await screenshot(page,`recovered-${width}.png`)
  await c.close()
 }
 checks.push('1440/390px: safe Cancel/Escape before POST; committed/lost response blocks repeat after edit/navigation/reload/reauth; denied/mismatched recovery retains reference; one native removal')
 phase='browser malformed posting responses'
 for(const mode of ['html','empty','wrong-key','clear-failure']){
  const c=await newContext();page=await newPage(c);const posts=postsFor(page);await open(page);await fill(page)
  if(mode==='clear-failure')await page.evaluate(()=>{const remove=Storage.prototype.removeItem;window.allowStockClear=false;Storage.prototype.removeItem=function(k){if(k.startsWith('campuspay:stock-adjustment:')&&!window.allowStockClear)throw new Error('Synthetic unavailable storage');return remove.call(this,k)}})
  else await page.route('**/api/inventory/adjustments',async r=>{const response=await r.fetch();assert.equal(response.status(),201);const data=(await response.json()).data;await r.fulfill({status:200,contentType:mode==='html'?'text/html':'application/json',body:mode==='html'?'<html>Unconfirmed proxy result</html>':JSON.stringify({ok:true,data:mode==='empty'?{}:{...data,idempotency_key:randomUUID()}})})},{times:1})
  await confirm(page);await pendingView(page);await expect(page.getByText(/^The removal result is not confirmed/)).toBeVisible();const key=posts[0].idempotencyKey;assert.equal(await saved(page),key);await postedOnce(key)
  if(mode==='clear-failure')await page.evaluate(()=>{window.allowStockClear=true})
  await page.getByRole('button',{name:'Recover original removal',exact:true}).click();await expect(page.getByRole('status').filter({hasText:'original removal is recorded once'})).toBeVisible();assert.equal(posts.length,1);await postedOnce(key);await c.close()
 }
 checks.push('Committed HTML/malformed/wrong-key successes and failed storage clearing retain recovery without a second POST')
 phase='browser storage failures'
 for(const mode of ['write-failure','read-failure','corrupt','no-locks']){
  const c=await newContext();await c.addInitScript(({mode,key})=>{
   if(mode==='corrupt')localStorage.setItem(key,'corrupt')
   if(mode==='no-locks')Object.defineProperty(navigator,'locks',{value:undefined})
   if(mode==='write-failure'){const set=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){if(k===key)throw new Error('Synthetic storage failure');return set.call(this,k,v)}}
   if(mode==='read-failure'){const get=Storage.prototype.getItem;Storage.prototype.getItem=function(k){if(k===key)throw new Error('Synthetic storage failure');return get.call(this,k)}}
  },{mode,key:storageKey})
  page=await newPage(c);const posts=postsFor(page);await open(page)
  if(mode==='write-failure'){await fill(page);await confirm(page);await expect(page.getByText(/No new removal was submitted/).first()).toBeVisible()}
  else await expect(page.getByRole('button',{name:'Review stock removal',exact:true})).toBeDisabled()
  assert.equal(posts.length,0);await c.close()
 }
 checks.push('Corrupt/unavailable read/write storage and missing browser locks deny new submissions')
 phase='cross-tab submission and closure race'
 {
  const c=await newContext(),a=await newPage(c),b=await newPage(c);page=a;const posts=[...[]];for(const p of [a,b])p.on('request',r=>{if(r.method()==='POST'&&new URL(r.url()).pathname==='/api/inventory/adjustments')posts.push({...r.postDataJSON(),tab:p===a?'a':'b'})})
  await open(a);await open(b);await fill(a);await fill(b)
  let release,arrived;const gate=new Promise(r=>{release=r}),seen=new Promise(r=>{arrived=r})
  await c.route('**/api/inventory/adjustments',async r=>{arrived();await gate;await r.continue()},{times:1})
  // Both handlers execute before either receives the other tab's storage event.
  await Promise.all([a.getByRole('button',{name:'Confirm removal',exact:true}).evaluate(el=>el.click()),b.getByRole('button',{name:'Confirm removal',exact:true}).evaluate(el=>el.click())]);await seen
  assert.equal(posts.length,1);const key=posts[0].idempotencyKey
  const sender=posts[0].tab==='a'?a:b,observer=posts[0].tab==='a'?b:a
  if(await observer.getByRole('dialog').count())await observer.getByRole('button',{name:'Cancel',exact:true}).click()
  await observer.getByRole('button',{name:'Recover stock removal',exact:true}).click();await pendingView(observer)
  await observer.getByRole('button',{name:'Recover original removal',exact:true}).click();await expect(observer.getByRole('status').filter({hasText:'closed without a stock removal'})).toBeVisible()
  release();await waitFor(async()=> (await footprint(key)).closures===1)
  // The original request, arriving after closure, must never decrement stock.
  await expect(sender.getByText(/removal result is not confirmed/).first()).toBeVisible()
  await c.unroute('**/api/inventory/adjustments');await new Promise(r=>setTimeout(r,100))
  assert.equal((await footprint(key)).adjustments,0);assert.equal((await footprint(key)).closureAudits,1);assert.equal(posts.length,1)
  await screenshot(observer,'cross-tab-closed-1440.png');await c.close()
 }
 checks.push('Real simultaneous tabs issue only one POST; second tab closes the stalled request and fences its late execution')
 assert.deepEqual(errors,[])
 fs.rmSync(out+'/failure.json',{force:true});fs.rmSync(out+'/failure.png',{force:true})
 fs.writeFileSync(out+'/results.json',JSON.stringify({passed:true,checks,native,screenshots,unexpectedBrowserErrors:errors,liveDataUsed:false},null,2)+'\n')
 console.log(JSON.stringify({passed:true,groups:checks.length,nativeChecks:native.length,screenshots:screenshots.length}))
}catch(error){if(page&&!page.isClosed())await page.screenshot({path:out+'/failure.png'}).catch(()=>{});fs.writeFileSync(out+'/failure.json',JSON.stringify({phase,error:error.message,checks},null,2));throw error}
finally{await browser?.close();await ctx?.close()}
