#!/usr/bin/env node
// Refuses non-CI and non-local databases. All identities below are synthetic.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import {randomBytes,randomUUID} from 'node:crypto'
import pg from 'pg'
import {refundTestContext} from './refund-test-context.mjs'
import {runRemovalBrowser} from './removal-browser.mjs'
const dir='.validation/removal',checks=[]
let ctx,phase='setup'
fs.mkdirSync(dir,{recursive:true})
try{
 ctx=await refundTestContext();await ctx.start(false,{administration:true,cash:true})
 const {owner,request,raw,login,staffPin,pin}=ctx
 const admin=await login(),inventory=await login('2001'),cashier=await login('1001'),accountant=await login('3001'),other=await login('9101')
 const session=await request(admin,'/api/auth/session'),cashierSession=await request(cashier,'/api/auth/session')
 session.terminal_id=(await owner.query('select terminal_id from private.staff_sessions where id=$1',[session.session_id])).rows[0].terminal_id
 cashierSession.terminal_id=(await owner.query('select terminal_id from private.staff_sessions where id=$1',[cashierSession.session_id])).rows[0].terminal_id
 const snapshot=async(kind,id)=>(await request(admin,`/api/removals?kind=${kind}&targetId=${id}`)).records[0]
 const input=async(kind,id,action='DELETE')=>({kind,action,targetId:id,expectedVersion:(await snapshot(kind,id)).version,requestKey:randomUUID(),adminPin:staffPin,reason:'Synthetic verified recoverable record deletion',verified:true})
 const change=(body,status=200,cookies=admin)=>request(cookies,'/api/removals',body,status)
 const recover=(body,cookies=admin,status=200)=>request(cookies,'/api/removals/recover',{kind:body.kind,requestKey:body.requestKey},status)
 const product=async(name='Synthetic removal product')=>request(inventory,'/api/management',{kind:'PRODUCT',action:'CREATE_PRODUCT',sku:'REMOVE-'+randomUUID().slice(0,8),name,category:'QA',sellingPriceWon:1000,reorderLevel:0,requestKey:randomUUID(),reason:'Synthetic fixture creation',verified:true})
 const p=await product(),productId=p.target_id
 const protectedState=async()=>JSON.stringify((await owner.query(`select
 (select md5(string_agg(to_jsonb(r)::text,'' order by r.id)) from private.sales r) sales,
 (select md5(string_agg(to_jsonb(r)::text,'' order by r.id)) from private.sale_items r) sale_items,
 (select md5(string_agg(to_jsonb(r)::text,'' order by r.id)) from private.sale_tenders r) tenders,
 (select md5(string_agg(to_jsonb(r)::text,'' order by r.id)) from private.sale_cost_allocations r) costs,
 (select md5(string_agg(to_jsonb(r)::text,'' order by r.id)) from private.wallet_ledger r) ledger,
 (select md5(string_agg(to_jsonb(r)::text,'' order by r.id)) from private.inventory_movements r) movements,
 (select md5(string_agg(to_jsonb(r)::text,'' order by r.id)) from private.inventory_lots r) lots,
 (select md5(string_agg(to_jsonb(r)::text,'' order by r.id)) from private.stock_receipts r) receipts,
 (select md5(string_agg(to_jsonb(r)::text,'' order by r.student_id)) from private.wallets r) wallets,
 (select md5(string_agg(to_jsonb(r)::text,'' order by r.id)) from private.student_cards r) cards,
 (select md5(string_agg(r.pin_hash,'' order by r.student_id)) from private.student_credentials r) student_pins,
 (select md5(string_agg(r.pin_hash,'' order by r.staff_user_id)) from private.staff_credentials r) staff_pins,
 (select md5(string_agg(to_jsonb(r)::text,'' order by r.id)) from private.coupon_redemptions r) redemptions`)).rows[0])
 phase='role, payload and independent activation gates'
 const initial=await input('PRODUCT',productId)
 await change(initial,409)
 await owner.query('update private.system_settings set administration_enabled=true,cash_controls_enabled=true where singleton')
 for(const cookies of [inventory,cashier,accountant,new Map()]){
  const status=cookies.size?403:401
  await change(initial,status,cookies);await request(cookies,'/api/removals',undefined,status);await recover(initial,cookies,status)
 }
 await request(admin,'/api/removals',initial,403,'https://untrusted.example')
 for(const extra of [{verified:false},{role:'super_admin'},{action:'PURGE'},{reason:'short'},{expectedVersion:'bad'},{targetId:'bad'}])await change({...initial,...extra},400)
 await request(admin,'/api/removals?offset=-1',undefined,400)
 await assert.rejects(()=>owner.query('select * from api.change_record_removal($1,$2,$3,$4,$5,$6,$7,$8)',[cashierSession.session_id,randomUUID(),'PRODUCT','DELETE',productId,initial.expectedVersion,ctx.staffPinProof(staffPin),initial.reason]),/FORBIDDEN/)
 const failed=Number((await owner.query('select failed_attempts from private.staff_credentials where staff_user_id=$1',[session.user_id])).rows[0].failed_attempts)
 await change({...initial,adminPin:staffPin==='00000000'?'11111111':'00000000'},403)
 assert.equal(Number((await owner.query('select failed_attempts from private.staff_credentials where staff_user_id=$1',[session.user_id])).rows[0].failed_attempts),failed+1)
 checks.push('Both activation gates, Super Admin authorization at HTTP and SQL, origin, strict confirmation and fresh PIN enforcement; wrong PIN counters commit')
 phase='product delete, concurrent replay, hidden directories and retained journals'
 const before=await protectedState(),deleted=await Promise.all([change(initial),change(initial)])
 assert.deepEqual(deleted[0],deleted[1]);assert.equal(deleted[0].deleted,true)
 assert.deepEqual(await recover(initial),deleted[0]);await recover(initial,other,403)
 const anotherAdminTerminal=await login();await recover(initial,anotherAdminTerminal,403)
 await change({...initial,reason:'Changed original request replay'},409)
 assert.equal((await request(admin,`/api/management?kind=PRODUCT&status=ALL&targetId=${productId}`)).total,0)
 assert.ok(!(await request(admin,'/api/inventory/products')).some(p=>p.id===productId))
 assert.ok(!(await request(admin,'/api/pos/catalog')).some(p=>p.id===productId))
 await assert.rejects(()=>owner.query('update public.products set active=true where id=$1',[productId]),/RECORD_REMOVED/)
 assert.equal(await protectedState(),before)
 const restored=await input('PRODUCT',productId,'RESTORE');await change(restored)
 assert.equal((await snapshot('PRODUCT',productId)).active,true)
 assert.equal((await snapshot('PRODUCT',productId)).deleted,false)
 assert.equal(await protectedState(),before)
 await change({...initial,requestKey:randomUUID()},409)
 const close=await input('PRODUCT',productId)
 assert.equal((await recover(close)).outcome,'CLOSED');assert.equal((await change(close)).outcome,'CLOSED')
 assert.equal((await snapshot('PRODUCT',productId)).deleted,false)
 checks.push('Product deletion/restore preserve stock and financial history, hide normal directory rows, reject legacy activation, replay exactly once and fence delayed requests closed')
 phase='student sessions, same credentials, balances and pending orders'
 const code='REMOVE-S-'+randomUUID().slice(0,8),card='REMOVAL'+randomBytes(10).toString('hex')
 const student=await request(admin,'/api/students',{studentCode:code,displayName:'Synthetic removal student',cardRead:card,pin,confirmationPin:pin,idempotencyKey:randomUUID()},201)
 const studentId=student.student_id,customer=new Map()
 await request(customer,'/api/store/login',{cardNumber:card,pin})
 const elevations=[]
 for(const purpose of ['RESET_STUDENT_PIN','RESET_STUDENT_CARD'])elevations.push(await request(admin,'/api/security/step-up',{superAdminEmployeeCode:'9001',superAdminPin:staffPin,purpose,studentId}))
 const studentBefore=await protectedState()
 await change(await input('STUDENT',studentId))
 const oldPinReset={authorizationToken:elevations[0].authorizationToken,newPin:pin,confirmationPin:pin}
 const oldCardReset={authorizationToken:elevations[1].authorizationToken,newCardRead:card+'NEW'}
 await request(admin,`/api/security/students/${studentId}/pin-reset`,oldPinReset,409)
 await request(admin,`/api/security/students/${studentId}/card-reset`,oldCardReset,409)
 assert.equal((await request(admin,`/api/students/roster?q=${code}&offset=0`)).length,0)
 assert.equal((await owner.query('select * from api.search_students($1,$2)',[session.session_id,code])).rows.length,0)
 assert.ok((await raw(customer,'/api/store/session')).status>=400)
 assert.ok((await raw(new Map(),'/api/store/login',{cardNumber:card,pin})).status>=400)
 await assert.rejects(()=>owner.query('update private.students set active=true where id=$1',[studentId]),/RECORD_REMOVED/)
 assert.equal(await protectedState(),studentBefore)
 await change(await input('STUDENT',studentId,'RESTORE'))
 await request(admin,`/api/security/students/${studentId}/pin-reset`,oldPinReset,403)
 await request(admin,`/api/security/students/${studentId}/card-reset`,oldCardReset,403)
 assert.ok((await raw(customer,'/api/store/session')).status>=400)
 await request(customer,'/api/store/login',{cardNumber:card,pin})
 assert.equal((await request(customer,'/api/store/session')).student_id,studentId)
 for(const amount of [-1000,1000]){await owner.query('update private.wallets set balance_won=$1 where student_id=$2',[amount,studentId]);await change(await input('STUDENT',studentId),409)}
 await owner.query('update private.wallets set balance_won=0 where student_id=$1',[studentId])
 const customerSession=await request(customer,'/api/store/session')
 const order=(await owner.query(`insert into private.online_orders(order_number,student_id,customer_session_id,delivery_location_id,delivery_building_snapshot,delivery_floor_snapshot,delivery_room_snapshot,subtotal_won,total_won,balance_before_won,balance_after_won,idempotency_key) select $1,$2,$3,id,'East Building',2,'QA',1000,1000,0,0,$4 from private.delivery_locations limit 1 returning id`,['REMOVE-'+randomUUID(),studentId,customerSession.session_id,randomUUID()])).rows[0]
 await owner.query('insert into private.online_order_items(order_id,product_id,product_name_snapshot,quantity,unit_price_won,line_total_won) values($1,$2,$3,1,1000,1000)',[order.id,productId,'Synthetic removal product'])
 await change(await input('STUDENT',studentId),409);await change(await input('PRODUCT',productId),409)
 await owner.query("update private.online_orders set status='DELIVERED' where id=$1",[order.id])
 const water=(await request(admin,'/api/inventory/products')).find(p=>p.sku==='WATER-001')
 await change(await input('PRODUCT',water.id),409)
 checks.push('Student deletion hides both roster versions and revokes access; restore retains card/PIN and never revives sessions; both wallet signs, stock and unfinished orders block deletion')
 phase='staff and register protection, sessions and inactive restoration'
 const staffInput=await input('STAFF',cashierSession.user_id),terminalInput=await input('TERMINAL',cashierSession.terminal_id)
 await change(await input('STAFF',session.user_id),403);await change(await input('TERMINAL',session.terminal_id),403)
 const shift=await request(cashier,'/api/cash/open',{requestKey:randomUUID(),counts:{'1000':2},verified:true})
 await change(staffInput,409);await change(terminalInput,409)
 await request(cashier,'/api/cash/close',{requestKey:randomUUID(),shiftId:shift.shift_id,counts:{'1000':2},notes:'Verified synthetic cash count',verified:true})
 const identityBefore=await protectedState()
 await change(staffInput)
 await request(admin,'/api/administration',{action:'RESET_STAFF_PIN',targetId:cashierSession.user_id,newPin:staffPin,confirmationPin:staffPin,adminPin:staffPin,notes:'Old synthetic PIN reset reviewed before deletion',verified:true,requestKey:randomUUID()},409)
 assert.ok(!(await request(admin,'/api/administration')).staff.some(r=>r.user_id===cashierSession.user_id))
 await request(cashier,'/api/auth/session',undefined,401)
 await request(new Map(),'/api/auth/login',{employeeCode:'1001',pin:staffPin},401)
 await assert.rejects(()=>owner.query('update public.staff_profiles set active=true where auth_user_id=$1',[cashierSession.user_id]),/RECORD_REMOVED/)
 await change(await input('STAFF',cashierSession.user_id,'RESTORE'))
 await request(cashier,'/api/auth/session',undefined,401);await login('1001',cashier)
 await change(terminalInput)
 assert.ok(!(await request(admin,'/api/administration')).terminals.some(r=>r.terminal_id===cashierSession.terminal_id))
 await request(cashier,'/api/auth/session',undefined,401)
 await request(cashier,'/api/auth/login',{employeeCode:'1001',pin:staffPin},403)
 await assert.rejects(()=>owner.query('update private.terminals set active=true where id=$1',[cashierSession.terminal_id]),/RECORD_REMOVED/)
 await change(await input('TERMINAL',cashierSession.terminal_id,'RESTORE'));await login('1001',cashier)
 assert.equal(await protectedState(),identityBefore)
 await owner.query('update public.products set active=false,updated_at=clock_timestamp() where id=$1',[productId])
 await change(await input('PRODUCT',productId));await change(await input('PRODUCT',productId,'RESTORE'))
 assert.equal((await snapshot('PRODUCT',productId)).active,false)
 await owner.query('update public.products set active=true,updated_at=clock_timestamp() where id=$1',[productId])
 checks.push('Current account/register and open drawers protected; staff/register deletion hides records and revokes sessions; restores keep PIN/identity and previous inactive state')
 phase='coupons, grants, journal immutability and safe audits'
 const couponCode='R'+randomBytes(6).toString('hex')
 const coupon=await request(inventory,'/api/coupons',{name:'Synthetic removable coupon',code:couponCode,discountType:'FIXED',fixedAmountWon:100,percentageBps:null,minimumSubtotalWon:0,maxDiscountWon:null,totalRedemptionLimit:10,perStudentLimit:null,startsAt:new Date(Date.now()-60000).toISOString(),endsAt:null,idempotencyKey:randomUUID()},201)
 const couponBefore=await protectedState()
 await change(await input('COUPON',coupon.coupon_id))
 assert.ok(!(await request(inventory,'/api/coupons')).some(c=>c.coupon_id===coupon.coupon_id))
 await assert.rejects(()=>owner.query('update private.coupons set active=true,deactivated_at=null,deactivated_by=null,deactivated_session_id=null,deactivation_reason=null where id=$1',[coupon.coupon_id]),/RECORD_REMOVED/)
 await change(await input('COUPON',coupon.coupon_id,'RESTORE'))
 assert.ok((await request(inventory,'/api/coupons')).some(c=>c.coupon_id===coupon.coupon_id&&c.active))
 assert.equal(await protectedState(),couponBefore)
 await request(inventory,`/api/coupons/${coupon.coupon_id}/deactivate`,{reason:'Original synthetic promotion withdrawal'})
 const inactiveCoupon=(await owner.query('select to_jsonb(c) value from private.coupons c where id=$1',[coupon.coupon_id])).rows[0].value
 await change(await input('COUPON',coupon.coupon_id));await change(await input('COUPON',coupon.coupon_id,'RESTORE'))
 assert.deepEqual((await owner.query('select to_jsonb(c) value from private.coupons c where id=$1',[coupon.coupon_id])).rows[0].value,inactiveCoupon)
 await owner.query('update private.coupons set active=true,deactivated_at=null,deactivated_by=null,deactivated_session_id=null,deactivation_reason=null where id=$1',[coupon.coupon_id])
 const runtime=new pg.Client({connectionString:ctx.runtimeUrl});await runtime.connect()
 try{for(const table of ['private.deleted_records','private.record_removal_operations'])await assert.rejects(()=>runtime.query(`select * from ${table}`),e=>e.code==='42501')}finally{await runtime.end()}
 await assert.rejects(()=>owner.query('update private.record_removal_operations set result=result'),/Journal entries cannot/)
 const audit=JSON.stringify((await owner.query("select safe_payload from private.audit_events where event_type like 'RECORD_REMOVAL%' ")).rows)
 for(const secret of [staffPin,pin,card,ctx.staffPinProof(staffPin)])assert.ok(!audit.includes(secret))
 checks.push('Coupon deletion hides both read APIs without changing redemptions; restoration works; runtime private-table bypass denied, immutable operation journal and credential-free audit verified')
 phase='posted sale retains deleted identities, original amounts and redemption'
 await owner.query('update private.system_settings set cash_controls_enabled=false where singleton')
 const current=(await request(inventory,`/api/management?kind=PRODUCT&status=ALL&targetId=${productId}`)).records[0]
 await request(inventory,'/api/management',{kind:'PRODUCT',action:'CHANGE_PRODUCT_PRICE',targetId:productId,expectedUpdatedAt:current.updated_at,sellingPriceWon:1100,requestKey:randomUUID(),reason:'Synthetic discounted sale fixture price',verified:true})
 const today=(await owner.query("select (clock_timestamp() at time zone 'Asia/Seoul')::date::text as business_date")).rows[0].business_date
 await request(inventory,'/api/inventory/receipts',{supplierName:'Synthetic removal supplier',supplierInvoice:randomUUID(),purchaseDate:today,shippingWon:0,otherCostsWon:0,discountWon:0,notes:'Synthetic retained history fixture',lines:[{productId,quantity:1,purchaseUnitCostWon:100}],idempotencyKey:randomUUID()},201)
 const credit=await request(accountant,'/api/accounting/intents',{direction:'CREDIT',denominations:[1000],reasonCode:'FUNDS_RECEIVED',notes:'Synthetic removal history deposit',idempotencyKey:randomUUID()},201)
 await request(accountant,`/api/accounting/intents/${credit.intent_id}/card`,{cardRead:card});await request(accountant,`/api/accounting/intents/${credit.intent_id}/confirm`,{pin})
 const saleIntent=await request(cashier,'/api/pos/intents',{items:[{productId,quantity:1}],tenderMode:'WALLET',couponCode,idempotencyKey:randomUUID()},201)
 await request(cashier,`/api/pos/intents/${saleIntent.intent_id}/card`,{cardRead:card})
 const receipt=await request(cashier,`/api/pos/intents/${saleIntent.intent_id}/confirm`,{pin})
 assert.ok(receipt.sale_id);assert.equal(Number((await owner.query('select balance_won from private.wallets where student_id=$1',[studentId])).rows[0].balance_won),0)
 assert.equal(Number((await owner.query('select count(*) n from private.coupon_redemptions where sale_id=$1',[receipt.sale_id])).rows[0].n),1)
 const postedBefore=await protectedState(),walletHistory=await request(accountant,`/api/accounting/students/${studentId}/history`)
 const linked=[['PRODUCT',productId],['STUDENT',studentId],['STAFF',cashierSession.user_id],['TERMINAL',cashierSession.terminal_id],['COUPON',coupon.coupon_id]]
 for(const [kind,id] of linked){await change(await input(kind,id));assert.equal(await protectedState(),postedBefore)}
 const historical=await request(admin,`/api/refunds/sale?reference=${receipt.sale_id}`)
 assert.equal(historical.sale_id,receipt.sale_id);assert.equal(historical.total_won,1000)
 assert.equal(Number((await owner.query('select discount_won from private.coupon_redemptions where sale_id=$1',[receipt.sale_id])).rows[0].discount_won),100)
 assert.deepEqual((await request(accountant,`/api/accounting/students/${studentId}/history`)).rows,walletHistory.rows)
 for(const [kind,id] of linked){await change(await input(kind,id,'RESTORE'));assert.equal(await protectedState(),postedBefore)}
 checks.push('An authenticated funded and discounted sale survives deletion/restore of every linked record; original sale/items/tenders/costs, receipt, ledger, card/PIN and coupon redemption remain byte-identical and historical reads work')
 phase='concurrent changes, pagination and recovery across disabled gates'
 const conflict=await input('PRODUCT',productId)
 const results=await Promise.all([raw(admin,'/api/removals',conflict),raw(anotherAdminTerminal,'/api/removals',{...conflict,requestKey:randomUUID()})])
 assert.deepEqual(results.map(x=>x.status).sort(),[200,409])
 await change(await input('PRODUCT',productId,'RESTORE'))
 const fence=await input('PRODUCT',productId)
 const fenced=await Promise.all([raw(admin,'/api/removals',fence),raw(admin,'/api/removals/recover',{kind:fence.kind,requestKey:fence.requestKey})])
 assert.ok(fenced.every(x=>x.status===200));assert.equal(fenced[0].body.data.outcome,fenced[1].body.data.outcome)
 if((await snapshot('PRODUCT',productId)).deleted)await change(await input('PRODUCT',productId,'RESTORE'))
 await owner.query(`with fixtures as(insert into public.products(sku,name,category,selling_price_won,reorder_level,active,created_by) select 'REMOVAL-PAGE-'||i,'Synthetic deleted page fixture '||i,'QA',1000,0,false,$1 from generate_series(1,61) i returning id) insert into private.deleted_records(kind,target_id,previous_active,deleted_at) select 'PRODUCT',id,true,clock_timestamp() from fixtures`,[session.user_id])
 const first=await request(admin,'/api/removals?kind=PRODUCT&offset=0'),second=await request(admin,'/api/removals?kind=PRODUCT&offset=50')
 assert.equal(first.records.length,50);assert.equal(first.total,61);assert.equal(second.records.length,11)
 assert.equal(new Set([...first.records,...second.records].map(r=>r.target_id)).size,61)
 await owner.query("insert into public.products(sku,name,category,selling_price_won,reorder_level,created_by) select 'REMOVAL-LIVE-'||i,'Synthetic live page fixture '||i,'QA',1000,0,$1 from generate_series(1,61) i",[session.user_id])
 const normalFirst=await request(admin,'/api/management?kind=PRODUCT&status=ALL&offset=0'),normalSecond=await request(admin,'/api/management?kind=PRODUCT&status=ALL&offset=50')
 assert.equal(normalFirst.records.length+normalSecond.records.length,normalFirst.total)
 assert.ok([...normalFirst.records,...normalSecond.records].every(r=>!r.code.startsWith('REMOVAL-PAGE-')))
 await owner.query('update private.system_settings set administration_enabled=false where singleton')
 assert.deepEqual(await recover(initial),deleted[0]);await change(await input('PRODUCT',productId),409)
 await ctx.start(false);await change(await input('PRODUCT',productId),403);assert.deepEqual(await recover(initial),deleted[0])
 await owner.query('update private.system_settings set administration_enabled=true where singleton');await ctx.start(false,{administration:true})
 checks.push('Stale concurrent changes yield one winner; change/recovery race converges; deletion filters precede pagination/counts; original recovery remains available after feature shutdown')
 phase='browser'
 const uiProduct=await product('Synthetic UI removable product')
 checks.push(...await runRemovalBrowser(ctx,{admin,inventory,productId:uiProduct.target_id,studentId,studentCode:code,couponId:coupon.coupon_id}))
 fs.writeFileSync(`${dir}/results.json`,JSON.stringify({checks,liveDataUsed:false},null,2))
 console.log(`Recoverable deletion passed: ${checks.length} acceptance groups; synthetic localhost only.`)
}catch(e){fs.writeFileSync(`${dir}/failure.txt`,`Phase: ${phase}\n${e.stack??e}`);console.error(`Recoverable deletion failed at ${phase}: ${e.message??'unknown'}`);process.exitCode=1}
finally{if(ctx)await ctx.close()}
