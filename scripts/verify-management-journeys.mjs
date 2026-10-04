#!/usr/bin/env node
// Entirely disposable localhost PostgreSQL and synthetic accounts. No school data.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { randomBytes, randomUUID } from 'node:crypto'
import pg from 'pg'
import { refundTestContext } from './refund-test-context.mjs'
import { runManagementBrowser } from './management-browser.mjs'
let ctx,phase='initialize'
const checks=[],dir='.validation/management'
fs.mkdirSync(dir,{recursive:true})
try {
 ctx=await refundTestContext();await ctx.start(false)
 const {owner,request,login,staffPin,pin}=ctx
 const admin=await login(),inventory=await login('2001'),cashier=await login('1001'),accountant=await login('3001')
 const adminSession=await request(admin,'/api/auth/session'),cashierSession=await request(cashier,'/api/auth/session')
 const common=()=>({requestKey:randomUUID(),reason:'Synthetic reviewed lifecycle change',verified:true})
 const create=(extra={})=>({...common(),kind:'PRODUCT',action:'CREATE_PRODUCT',sku:`MGMT-${randomUUID().slice(0,8)}`,name:'Synthetic managed product',category:'QA',sellingPriceWon:1000,reorderLevel:0,...extra})
 const post=(cookies,input,status=200)=>request(cookies,'/api/management',input,status)
 const recovery=(cookies,kind,key,status=200)=>request(cookies,'/api/management/recover',{kind,requestKey:key},status)
 const directory=(cookies,kind='PRODUCT',id)=>request(cookies,`/api/management?kind=${kind}&status=ALL${id?`&targetId=${id}`:''}`)
 const current=async(kind,id)=>(await directory(kind==='PRODUCT'?inventory:admin,kind,id)).records[0]
 const edit=async(kind,id,action,extra={})=>({...common(),kind,action,targetId:id,expectedUpdatedAt:(await current(kind,id)).updated_at,...extra})
 const productCount=async sku=>Number((await owner.query('select count(*) from public.products where sku=$1',[sku])).rows[0].count)
 const stock=async id=>Number((await owner.query('select coalesce(sum(quantity_remaining),0) n from private.inventory_lots where product_id=$1',[id])).rows[0].n)
 const snapshot=async()=>JSON.stringify((await owner.query(`select
 (select md5(string_agg(to_jsonb(r)::text,'' order by r.id)) from private.sales r) sales,
 (select md5(string_agg(to_jsonb(r)::text,'' order by r.id)) from private.sale_items r) sale_items,
 (select md5(string_agg(to_jsonb(r)::text,'' order by r.id)) from private.wallet_ledger r) wallet_ledger,
 (select md5(string_agg(to_jsonb(r)::text,'' order by r.id)) from private.inventory_movements r) movements,
 (select md5(string_agg(to_jsonb(r)::text,'' order by r.id)) from private.stock_receipts r) receipts,
 (select md5(string_agg(to_jsonb(r)::text,'' order by r.student_id)) from private.wallets r) wallets,
 (select md5(string_agg(to_jsonb(r)::text,'' order by r.id)) from private.student_cards r) cards,
 (select md5(string_agg(to_jsonb(r)::text,'' order by r.student_id)) from private.student_credentials r) credentials`)).rows[0])
 phase='role, origin and payload enforcement'
 const input=create()
 await post(new Map(),input,401)
 for(const who of [cashier,accountant]){await post(who,input,403);await request(who,'/api/management?kind=PRODUCT',undefined,403);await recovery(who,'PRODUCT',input.requestKey,403)}
 for(const who of [inventory,cashier,accountant])await request(who,'/api/management?kind=STUDENT',undefined,403)
 await request(admin,'/api/management',input,403,'https://untrusted.example')
 for(const extra of [{verified:false},{role:'super_admin'},{sellingPriceWon:-1},{stock:100},{action:'DELETE_PRODUCT'}])await post(inventory,{...input,...extra},400)
 await request(admin,'/api/management?kind=PRODUCT&offset=-1',undefined,400)
 await assert.rejects(()=>owner.query('select * from api.record_directory($1,$2,$3,$4,$5,$6)',[cashierSession.session_id,'PRODUCT','','ALL',0,null]),/FORBIDDEN/)
 checks.push('Anonymous, wrong-role, wrong-surface, forged payload, invalid page and cross-origin requests denied; DB authorization independently enforced')
 phase='create, exact replay and recovery ownership'
 const before=await snapshot(),created=await post(inventory,input),id=created.target_id
 assert.equal(created.outcome,'COMPLETED');assert.equal(await stock(id),0)
 assert.deepEqual(await post(inventory,input),created);assert.equal(await productCount(input.sku),1)
 await post(inventory,{...input,name:'Changed replay'},409)
 await recovery(admin,'PRODUCT',input.requestKey,403)
 const otherTerminal=await login('2001');await recovery(otherTerminal,'PRODUCT',input.requestKey,403)
 await login('2001',inventory);assert.deepEqual(await recovery(inventory,'PRODUCT',input.requestKey),created)
 assert.deepEqual(await post(inventory,input),created)
 const concurrent=create(),pair=await Promise.all([post(inventory,concurrent),post(inventory,concurrent)])
 assert.equal(pair[0].target_id,pair[1].target_id);assert.equal(await productCount(concurrent.sku),1)
 const closed=create();assert.equal((await recovery(inventory,'PRODUCT',closed.requestKey)).outcome,'CLOSED')
 assert.equal((await post(inventory,closed)).outcome,'CLOSED');assert.equal(await productCount(closed.sku),0)
 await post(inventory,create({sku:input.sku}),409)
 checks.push('Creation is zero-stock and exactly-once; changed replay and wrong operator/register rejected; re-login recovery and permanent closure fence verified')
 phase='metadata, price and availability'
 const update=await edit('PRODUCT',id,'UPDATE_PRODUCT',{name:'Renamed fixture',category:'QA revised',reorderLevel:6})
 await post(inventory,update);await post(inventory,{...update,requestKey:randomUUID()},409)
 const price=await edit('PRODUCT',id,'CHANGE_PRODUCT_PRICE',{sellingPriceWon:1500})
 await post(inventory,price);assert.equal((await current('PRODUCT',id)).selling_price_won,1500)
 assert.equal(Number((await owner.query('select count(*) n from private.product_price_history where product_id=$1',[id])).rows[0].n),1)
 const archive=await edit('PRODUCT',id,'ARCHIVE_PRODUCT');await post(inventory,archive)
 assert.equal((await current('PRODUCT',id)).active,false)
 assert.ok(!(await request(admin,'/api/pos/catalog')).some(p=>p.id===id))
 await post(inventory,await edit('PRODUCT',id,'RESTORE_PRODUCT'));assert.equal((await current('PRODUCT',id)).active,true)
 assert.equal((await current('PRODUCT',id)).code,input.sku);assert.equal(await stock(id),0);assert.equal(await snapshot(),before)
 const water=(await request(inventory,'/api/inventory/products')).find(p=>p.sku==='WATER-001')
 await post(inventory,await edit('PRODUCT',water.id,'ARCHIVE_PRODUCT'),409)
 assert.match((await current('PRODUCT',water.id)).blocker,/remaining stock/)
 checks.push('Version conflicts reject stale edits; audited price history retained; archive/restore preserve SKU, journals and stock; nonzero stock blocks retirement')
 phase='student deactivation and active-session boundaries'
 const card=`MANAGE${randomBytes(10).toString('hex')}`,studentCode=`MGMT-S-${randomUUID().slice(0,8)}`
 const enrolled=await request(admin,'/api/students',{studentCode,displayName:'Synthetic status customer',cardRead:card,pin,confirmationPin:pin,idempotencyKey:randomUUID()},201)
 const studentId=enrolled.student_id,customer=new Map()
 await request(customer,'/api/store/login',{cardNumber:card,pin})
 await post(customer,create(),401)
 const oldCustomer=await request(customer,'/api/store/session')
 const pendingWallet=await request(accountant,'/api/accounting/intents',{direction:'CREDIT',denominations:[1000],reasonCode:'FUNDS_RECEIVED',notes:'Synthetic pending credit',idempotencyKey:randomUUID()},201)
 await request(accountant,`/api/accounting/intents/${pendingWallet.intent_id}/card`,{cardRead:card})
 const deactivate=await edit('STUDENT',studentId,'DEACTIVATE_STUDENT',{adminPin:staffPin})
 for(const who of [inventory,cashier,accountant])await post(who,deactivate,403)
 const failedBefore=Number((await owner.query('select failed_attempts from private.staff_credentials where staff_user_id=$1',[adminSession.user_id])).rows[0].failed_attempts)
 const invalid=staffPin==='00000000'?'11111111':'00000000'
 await post(admin,{...deactivate,adminPin:invalid},403)
 assert.equal(Number((await owner.query('select failed_attempts from private.staff_credentials where staff_user_id=$1',[adminSession.user_id])).rows[0].failed_attempts),failedBefore+1)
 const studentBefore=await snapshot();await post(admin,deactivate)
 assert.equal((await current('STUDENT',studentId)).active,false);assert.equal(await snapshot(),studentBefore)
 const oldResponse=await ctx.raw(customer,'/api/store/session');assert.ok([401,403].includes(oldResponse.status))
 await request(accountant,`/api/accounting/intents/${pendingWallet.intent_id}/confirm`,{pin},403)
 assert.equal(Number((await owner.query('select balance_won from private.wallets where student_id=$1',[studentId])).rows[0].balance_won),0)
 assert.ok((await ctx.raw(new Map(),'/api/store/login',{cardNumber:card,pin})).status>=400)
 await assert.rejects(()=>owner.query(`insert into private.customer_sessions(student_id,session_token_hash,ip_fingerprint,expires_at,max_expires_at) values($1,$2,$3,now()+interval '5 minutes',now()+interval '8 hours')`,[studentId,randomBytes(32).toString('hex'),randomBytes(32).toString('hex')]),/FORBIDDEN/)
 await post(admin,await edit('STUDENT',studentId,'REACTIVATE_STUDENT',{adminPin:staffPin}))
 assert.equal((await current('STUDENT',studentId)).id,studentId)
 assert.ok((await ctx.raw(customer,'/api/store/session')).status>=400)
 await request(customer,'/api/store/login',{cardNumber:card,pin})
 assert.equal((await request(customer,'/api/store/session')).student_id,studentId)
 await request(accountant,`/api/accounting/intents/${pendingWallet.intent_id}/recover`,{})
 checks.push('Student changes require current Super Admin PIN; deactivation revokes sessions and blocks pending legacy wallet posting and late session insertion; reactivation keeps identities/credentials without reviving old sessions')
 phase='wallet and unfinished-order guards'
 // Controlled synthetic setup only; no production wallet is ever altered.
 for(const amount of [-1000,1000]){
  await owner.query('update private.wallets set balance_won=$1 where student_id=$2',[amount,studentId])
  await post(admin,await edit('STUDENT',studentId,'DEACTIVATE_STUDENT',{adminPin:staffPin}),409)
 }
 await owner.query('update private.wallets set balance_won=0 where student_id=$1',[studentId])
 const activeCustomer=await request(customer,'/api/store/session')
 const order=(await owner.query(`insert into private.online_orders(order_number,student_id,customer_session_id,delivery_location_id,delivery_building_snapshot,delivery_floor_snapshot,delivery_room_snapshot,subtotal_won,total_won,balance_before_won,balance_after_won,idempotency_key) select $1,$2,$3,id,'East Building',2,'QA',1000,1000,0,0,$4 from private.delivery_locations limit 1 returning id`,[`MGMT-${randomUUID()}`,studentId,activeCustomer.session_id,randomUUID()])).rows[0]
 await owner.query('insert into private.online_order_items(order_id,product_id,product_name_snapshot,quantity,unit_price_won,line_total_won) values($1,$2,$3,1,1000,1000)',[order.id,id,'Synthetic pending item'])
 await post(inventory,await edit('PRODUCT',id,'ARCHIVE_PRODUCT'),409)
 await post(admin,await edit('STUDENT',studentId,'DEACTIVATE_STUDENT',{adminPin:staffPin}),409)
 await owner.query("update private.online_orders set status='DELIVERED' where id=$1",[order.id])
 checks.push('Positive/negative balances are not erased; unfinished delivery blocks both product retirement and student deactivation')
 phase='database grants, strict RPC and journal immutability'
 const invSession=await request(inventory,'/api/auth/session'),record=await current('PRODUCT',id)
 await assert.rejects(()=>owner.query('select * from api.change_record($1,$2,$3,$4,$5,$6,$7,$8)',[invSession.session_id,randomUUID(),'PRODUCT','ARCHIVE_PRODUCT',id,JSON.stringify({expected_updated_at:record.updated_at,stock:0}),null,'Attempted unauthorized property']),/BAD_REQUEST/)
 const runtime=new pg.Client({connectionString:ctx.runtimeUrl});await runtime.connect()
 try{await assert.rejects(()=>runtime.query('select * from private.record_management_operations'),e=>e.code==='42501');await assert.rejects(()=>runtime.query('select * from private.confirm_wallet_adjustment_legacy($1,$2,$3)',[null,null,null]),e=>e.code==='42501')}finally{await runtime.end()}
 await assert.rejects(()=>owner.query('update private.record_management_operations set result=result'),/Journal entries cannot/)
 const safe=JSON.stringify((await owner.query("select safe_payload from private.audit_events where event_type like 'RECORD_MANAGEMENT%' ")).rows)
 assert.ok(!safe.includes(staffPin)&&!safe.includes(pin)&&!safe.includes(card))
 checks.push('Runtime cannot bypass wrapper/read private journals; direct-RPC extra properties rejected; operation journal immutable and audit excludes credentials')
 phase='concurrent editors and recovery fencing'
 const raceRecord=await current('PRODUCT',id)
 const raceInput={...common(),kind:'PRODUCT',action:'UPDATE_PRODUCT',targetId:id,expectedUpdatedAt:raceRecord.updated_at,name:'First concurrent revision',category:'QA',reorderLevel:0}
 const races=await Promise.all([ctx.raw(inventory,'/api/management',raceInput),ctx.raw(otherTerminal,'/api/management',{...raceInput,requestKey:randomUUID(),name:'Second concurrent revision'})])
 assert.deepEqual(races.map(r=>r.status).sort(),[200,409])
 const fenceInput=create()
 const fenced=await Promise.all([ctx.raw(inventory,'/api/management',fenceInput),ctx.raw(inventory,'/api/management/recover',{kind:'PRODUCT',requestKey:fenceInput.requestKey})])
 assert.ok(fenced.every(r=>r.status===200))
 assert.equal(fenced[0].body.data.outcome,fenced[1].body.data.outcome)
 assert.equal(await productCount(fenceInput.sku),fenced[0].body.data.outcome==='COMPLETED'?1:0)
 checks.push('Concurrent editors cannot overwrite a newer version; racing change/recovery converges on one committed result or one permanent closure')
 phase='browser management and confirmation'
 const browserResult=await runManagementBrowser(ctx,{admin,inventory,studentId,studentCode,card})
 checks.push(...browserResult.checks)
 fs.writeFileSync(`${dir}/results.json`,JSON.stringify({checks,browser:browserResult,oldCustomerSessionRevoked:!!oldCustomer.session_id,liveDataUsed:false},null,2))
 console.log(`Management journeys passed: ${checks.length} acceptance groups; disposable localhost only.`)
}catch(error){fs.writeFileSync(`${dir}/failure.txt`,`Phase: ${phase}\n${error.stack??error}`);console.error(`Management journeys failed at ${phase}: ${error.message??'unknown'}`);process.exitCode=1}
finally{if(ctx)await ctx.close()}
