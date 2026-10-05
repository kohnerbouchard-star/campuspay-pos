#!/usr/bin/env node
import assert from 'node:assert/strict'
import {randomBytes,randomUUID} from 'node:crypto'
import fs from 'node:fs'
import pg from 'pg'
import {refundTestContext} from './refund-test-context.mjs'
import {runOperationsBrowser} from './operations-browser.mjs'
let ctx,phase='setup';const checks=[]
try {
 ctx=await refundTestContext();await ctx.start(true)
 const {owner,request,raw,login,pin}=ctx
 let admin=await login();const cashier=await login('1001'),accountant=await login('3001'),other=await login('9101'),inventory=await login('2001')
 const products=await request(admin,'/api/pos/catalog'),water=products.find(p=>p.sku==='WATER-001')
 // Use a fresh test card whose value is known only to this local fixture.
 const card='OPS'+randomBytes(10).toString('hex')
 const person=await request(admin,'/api/students',{studentCode:'OPS-'+randomBytes(6).toString('hex'),displayName:'Synthetic return customer',cardRead:card,pin,confirmationPin:pin,idempotencyKey:randomUUID()},201)
 const customer=new Map();await request(customer,'/api/store/login',{cardNumber:card,pin})
 const locations=await request(customer,'/api/store/locations');const room=locations.find(l=>l.room==='201')
 async function order(){const receipt=await request(customer,'/api/store/orders',{items:[{productId:water.id,quantity:1}],deliveryLocationId:room.location_id,idempotencyKey:randomUUID(),expectedTotalWon:1200},201);return {receipt,detail:await request(admin,`/api/refunds/sale?reference=${receipt.order_number}`)}}
 async function dispatch(o,delivered=false){for(const status of ['PICKING','READY','OUT_FOR_DELIVERY',...(delivered?['DELIVERED']:[])])await request(cashier,`/api/orders/${o.receipt.order_id}/status`,{status})}
 const refundInput=(s,restock=true)=>({saleId:s.sale_id,idempotencyKey:randomUUID(),reasonCode:'CUSTOMER_RETURN',notes:'All goods returned and inspected by staff',verified:true,items:s.items.map(i=>({sale_item_id:i.sale_item_id,disposition:restock?'RESTOCK':'WRITE_OFF'}))})
 const balance=async()=>Number((await owner.query('select balance_won from private.wallets where student_id=$1',[person.student_id])).rows[0].balance_won)
 const o=await order();await dispatch(o,true);const input={...refundInput(o.detail),returnReason:'CUSTOMER_RETURN'}
 phase='return-gates';await request(admin,'/api/refunds/return',input,409)
 await ctx.start(true,{returns:true,cash:true});admin=await login('9001',admin)
 await owner.query('update private.system_settings set refunds_enabled=true where singleton')
 assert.equal((await request(admin,'/api/refunds/return',input)).outcome,'DISABLED')
 await owner.query('update private.system_settings set returns_enabled=true where singleton')
 for(const role of [cashier,accountant,inventory,new Map()])await request(role,'/api/refunds/return',input,role.size?403:401)
 await request(admin,'/api/refunds/return',{...input,returnReason:null},400)
 assert.equal((await request(admin,'/api/refunds',refundInput(o.detail))).outcome,'ORDER_DISPATCHED')
 checks.push('original cancellation boundary and dual default-off return gates retained')
 phase='return-settlement';const before=await balance();const r=await request(admin,'/api/refunds/return',input)
 assert.equal(r.outcome,'COMPLETED');assert.equal(r.refund.kind,'ONLINE_RETURN');assert.equal(await balance(),before+1200)
 assert.deepEqual(await request(admin,'/api/refunds/return',input),r)
 assert.deepEqual(await request(admin,'/api/refunds/recover',{saleId:input.saleId,idempotencyKey:input.idempotencyKey}),r)
 assert.equal((await owner.query('select status from private.online_orders where id=$1',[o.receipt.order_id])).rows[0].status,'RETURNED')
 assert.equal((await owner.query('select reason,previous_status from private.online_return_inspections where order_id=$1',[o.receipt.order_id])).rows[0].previous_status,'DELIVERED')
 await request(cashier,`/api/orders/${o.receipt.order_id}/status`,{status:'DELIVERED'},409)
 const shown=(await request(customer,'/api/store/orders')).find(x=>x.order_id===o.receipt.order_id);assert.equal(shown.timeline.at(-1).status,'RETURNED')
 const failed=await order();await dispatch(failed)
 const f={...refundInput(failed.detail,false),returnReason:'FAILED_DELIVERY'}
 const raced=await Promise.all([request(admin,'/api/refunds/return',f),request(other,'/api/refunds/return',{...f,idempotencyKey:randomUUID()})])
 assert.deepEqual(raced.map(x=>x.outcome).sort(),['ALREADY_REFUNDED','COMPLETED'])
 assert.ok(raced[0].refund.write_off_cost_won>0)
 const delivered=await order();await dispatch(delivered,true)
 assert.equal((await request(admin,'/api/refunds/return',{...refundInput(delivered.detail),returnReason:'FAILED_DELIVERY'})).outcome,'RETURN_INELIGIBLE')
 checks.push('post-dispatch and failed-delivery returns, original-tender credit, status/timeline, inspection, duplicate/race and retry checks')
 phase='cash-open-gates';await request(inventory,'/api/cash',undefined,403)
 const initial=await request(admin,'/api/cash');assert.equal(initial.enabled,false)
 const opening={requestKey:randomUUID(),counts:{'10000':1},verified:true}
 await request(admin,'/api/cash/open',opening,409);await request(accountant,'/api/cash/open',opening,409)
 await owner.query('update private.system_settings set cash_controls_enabled=true where singleton')
 async function cashSale(mode='CASH',expected=200){
  await request(admin,'/api/pos/payment-policy',{cashEnabled:true,eventName:'Operations cash test',endsAt:new Date(Date.now()+3600000).toISOString()})
  const intent=await request(admin,'/api/pos/intents',{items:[{productId:water.id,quantity:1}],tenderMode:mode,idempotencyKey:randomUUID()},201)
  if(mode==='SPLIT'){await request(admin,`/api/pos/intents/${intent.intent_id}/card`,{cardRead:card});await request(admin,`/api/pos/intents/${intent.intent_id}/tender`,{walletAmountWon:500})}
  return request(admin,`/api/pos/intents/${intent.intent_id}/confirm`,{cashReceivedWon:10000,...(mode==='SPLIT'?{pin}:{})},expected)
 }
 const saleCount=Number((await owner.query('select count(*) from private.sales')).rows[0].count)
 const rejected=await cashSale('CASH',409);assert.equal(rejected.code,'CASH_SHIFT_REQUIRED')
 assert.equal(Number((await owner.query('select count(*) from private.sales')).rows[0].count),saleCount)
 const shift=await request(admin,'/api/cash/open',opening);assert.equal(shift.expected_won,10000)
 assert.deepEqual(await request(admin,'/api/cash/open',opening),shift)
 await request(admin,'/api/cash/open',{...opening,counts:{'5000':2}},409)
 const c=await cashSale(),split=await cashSale('SPLIT');assert.ok(split.sale_id)
 const cDetail=await request(admin,`/api/refunds/sale?reference=${c.sale_id}`)
 const cRefund=(await request(admin,'/api/refunds',refundInput(cDetail))).refund
 await request(admin,'/api/refunds/payout',{refundId:cRefund.refund_id,idempotencyKey:randomUUID(),amountWon:1200,handoverReference:'Observed synthetic payout',confirmed:true})
 const snapshot=await request(admin,'/api/cash');assert.equal(snapshot.current_shift.cash_sales_won,1900);assert.equal(snapshot.current_shift.cash_payouts_won,1200);assert.equal(snapshot.current_shift.expected_won,10700)
 checks.push('cash needs an open drawer, excludes change, captures exact cash/split settlement and cash payout atomically')
 phase='cash-close';const close={shiftId:shift.shift_id,requestKey:randomUUID(),counts:{'10000':1,'500':1,'100':2},notes:'Verified exact physical drawer count',verified:true}
 await request(other,'/api/cash/close',close,403)
 const closed=await request(admin,'/api/cash/close',close);assert.equal(closed.variance_won,0);assert.equal(closed.review_required,false)
 assert.deepEqual(await request(admin,'/api/cash/close',close),closed)
 await request(admin,'/api/cash/close',{...close,counts:{'10000':1}},409)
 await cashSale('CASH',409)
 const next=await request(admin,'/api/cash/open',{requestKey:randomUUID(),counts:{'1000':2},verified:true})
 const short=await request(admin,'/api/cash/close',{...close,requestKey:randomUUID(),shiftId:next.shift_id,counts:{'1000':1},notes:'One thousand won short; counted twice'})
 assert.equal(short.variance_won,-1000);assert.equal(short.review_required,true)
 await request(admin,'/api/cash/review',{shiftId:next.shift_id,notes:'Review attempted by own closer'},403)
 const reviewed=await request(accountant,'/api/cash/review',{shiftId:next.shift_id,notes:'Independently checked and approved shortage'})
 assert.equal(reviewed.review_required,false);assert.equal(reviewed.variance_won,-1000)
 checks.push('immutable exact close, changed replay/cross-terminal denial, separate variance review without erasing shortage')
 phase='cash-recovery';const missing={requestKey:randomUUID(),operation:'OPEN',shiftId:null}
 assert.equal((await request(admin,'/api/cash/recover',missing)).outcome,'CLOSED')
 await request(admin,'/api/cash/open',{...opening,requestKey:missing.requestKey},409)
 const recovered=await request(admin,'/api/cash/recover',{requestKey:close.requestKey,operation:'CLOSE',shiftId:close.shiftId});assert.equal(recovered.shift.shift_id,shift.shift_id)
 await request(other,'/api/cash/recover',{requestKey:close.requestKey,operation:'CLOSE',shiftId:close.shiftId},403)
 const rt=new pg.Client({connectionString:ctx.runtimeUrl});await rt.connect()
 try{await assert.rejects(()=>rt.query('select * from private.cash_shift_events'),e=>e.code==='42501');await assert.rejects(()=>rt.query('select * from private.online_return_inspections'),e=>e.code==='42501')}finally{await rt.end()}
 await assert.rejects(()=>owner.query('update private.cash_shift_closes set counted_won=counted_won'),e=>e.code==='P0001')
 checks.push('opaque cash recovery, closure fencing, original operator/terminal binding and immutable/private-table denials')
 phase='cash-close-races'
 for(let attempt=0;attempt<3;attempt++){
  const sh=await request(admin,'/api/cash/open',{requestKey:randomUUID(),counts:{'1000':2},verified:true})
  await assert.rejects(()=>owner.query('update private.system_settings set cash_controls_enabled=false where singleton'),e=>e.code==='P0001')
  const intent=await request(admin,'/api/pos/intents',{items:[{productId:water.id,quantity:1}],tenderMode:'CASH',idempotencyKey:randomUUID()},201)
  const [paid,closeResult]=await Promise.all([
   raw(admin,`/api/pos/intents/${intent.intent_id}/confirm`,{cashReceivedWon:10000}),
   request(admin,'/api/cash/close',{requestKey:randomUUID(),shiftId:sh.shift_id,counts:{'1000':2},notes:'Concurrent close test physical count',verified:true})])
  assert.ok([200,409].includes(paid.status))
  if(paid.status===409)assert.equal(paid.body.error.code,'CASH_SHIFT_REQUIRED')
  assert.equal(closeResult.expected_won,2000+(paid.status===200?1200:0))
  assert.equal(Number((await owner.query('select coalesce(sum(amount_won),0) as total from private.cash_shift_events where shift_id=$1',[sh.shift_id])).rows[0].total),closeResult.expected_won-2000)
 }
 checks.push('three concurrent checkout/close races include each committed cash sale exactly once; open-shift attribution cannot be disabled')
 phase='browser';await runOperationsBrowser(ctx,await login(),delivered.receipt.order_number)
 checks.push('cash opening response-loss recovery and verified return UI on four viewports')
 fs.mkdirSync('.validation/operations',{recursive:true});fs.writeFileSync('.validation/operations/results.json',JSON.stringify({checks,liveDataUsed:false},null,2))
 console.log(`Operations passed: ${checks.length} acceptance groups; synthetic isolated data only.`)
}catch(e){fs.mkdirSync('.validation/operations',{recursive:true});fs.writeFileSync('.validation/operations/failure.txt',`Phase: ${phase}\n${e?.stack??'unknown'}`);console.error(`Operations test failed at ${phase}: ${e?.message??'unknown'}`);process.exitCode=1}
finally{if(ctx)await ctx.close()}
