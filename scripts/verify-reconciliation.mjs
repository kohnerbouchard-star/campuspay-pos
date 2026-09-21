#!/usr/bin/env node
// One mixed operating-day fixture through authenticated APIs, isolated locally.
import assert from 'node:assert/strict'
import { randomBytes,randomUUID } from 'node:crypto'
import fs from 'node:fs'
import { chromium,expect } from '@playwright/test'
import { refundTestContext } from './refund-test-context.mjs'
let ctx,browser,phase='setup'
try{
 ctx=await refundTestContext();await ctx.start(true,{cash:true,funding:true,partialRefunds:true})
 const {owner,request,login,pin}=ctx,admin=await login(),accountant=await login('3001'),cashier=await login('1001'),inventory=await login('2001')
 const day=(await owner.query("select (clock_timestamp() at time zone 'Asia/Seoul')::date::text as business_date")).rows[0].business_date
 const endpoint=`/api/reconciliation?day=${day}`,metric=(r,key)=>{const value=r.metrics.find(m=>m.key===key);assert.ok(value,`Missing metric ${key}`);return value.value}
 const initial=await request(accountant,endpoint)
 assert.equal(initial.status,'DISCREPANCIES');assert.equal(initial.checks.find(c=>c.code==='WALLET_BALANCES').discrepancies,1)
 for(const who of [cashier,inventory,new Map()])await request(who,endpoint,undefined,who.size?403:401)
 await request(accountant,'/api/reconciliation?day=2026-02-30',undefined,400)
 await owner.query('update private.system_settings set funding_enabled=true,cash_controls_enabled=true,refunds_enabled=true,partial_refunds_enabled=true where singleton')
 const card='RECON'+randomBytes(12).toString('hex')
 const student=await request(admin,'/api/students',{studentCode:'RECON-'+randomUUID().slice(0,8),displayName:'Synthetic reconciliation student',cardRead:card,pin,confirmationPin:pin,idempotencyKey:randomUUID()},201)
 const sh=await request(admin,'/api/cash/open',{requestKey:randomUUID(),counts:{'50000':1},verified:true})
 const key=randomUUID();await request(admin,'/api/funding/prepare',{requestKey:key,action:'CASH_DEPOSIT',denominations:[10000],cashReceivedWon:20000,sourceReference:'Synthetic deposited cash',notes:'Counted deposit with change returned'})
 await request(admin,'/api/funding/card',{requestKey:key,cardRead:card});await request(admin,'/api/funding/confirm',{requestKey:key,studentPin:pin,verified:true})
 phase='mixed sales and refund'
 const water=(await request(admin,'/api/pos/catalog')).find(p=>p.sku==='WATER-001')
 await request(admin,'/api/pos/payment-policy',{cashEnabled:true,eventName:'Synthetic reconciliation',endsAt:new Date(Date.now()+3600000).toISOString()})
 const intent=await request(admin,'/api/pos/intents',{items:[{productId:water.id,quantity:2}],tenderMode:'SPLIT',idempotencyKey:randomUUID()},201)
 await request(admin,`/api/pos/intents/${intent.intent_id}/card`,{cardRead:card});await request(admin,`/api/pos/intents/${intent.intent_id}/tender`,{walletAmountWon:500})
 const sale=await request(admin,`/api/pos/intents/${intent.intent_id}/confirm`,{pin,cashReceivedWon:10000})
 const customer=new Map();await request(customer,'/api/store/login',{cardNumber:card,pin})
 const room=(await request(customer,'/api/store/locations')).find(r=>r.room==='201')
 await request(customer,'/api/store/orders',{items:[{productId:water.id,quantity:1}],deliveryLocationId:room.location_id,idempotencyKey:randomUUID(),expectedTotalWon:1200},201)
 const details=await request(admin,`/api/refunds/items?reference=${sale.sale_id}`),allocation=details.allocations.find(a=>a.remaining_quantity>=1)
 const refund=await request(admin,'/api/refunds/items',{saleId:sale.sale_id,idempotencyKey:randomUUID(),expectedRefundCount:0,items:[{original_allocation_id:allocation.original_allocation_id,restock_quantity:1,write_off_quantity:0}],reasonCode:'CUSTOMER_RETURN',notes:'One saleable item returned and inspected',verified:true})
 assert.equal(refund.outcome,'COMPLETED');assert.equal(refund.refund.total_won,1200);assert.equal(refund.refund.wallet_credit_won,250)
 await request(admin,'/api/refunds/payout',{refundId:refund.refund.refund_id,idempotencyKey:randomUUID(),amountWon:950,handoverReference:'Observed synthetic handback',confirmed:true})
 await request(admin,'/api/cash/close',{requestKey:randomUUID(),shiftId:sh.shift_id,counts:{'50000':1,'10000':1,'500':1,'100':4,'50':1},notes:'Exact physical close after mixed activity',verified:true})
 const before=(await owner.query("select (select md5(string_agg(to_jsonb(l)::text,'' order by l.id)) from private.wallet_ledger l) wallet,(select md5(string_agg(to_jsonb(m)::text,'' order by m.id)) from private.inventory_movements m) inventory,(select md5(string_agg(to_jsonb(e)::text,'' order by e.id)) from private.cash_shift_events e) cash")).rows[0]
 phase='reconciliation report'
 const report=await request(accountant,endpoint)
 const expected={sales_count:2,gross_sales:3600,discounts:0,refund_count:1,refunds:1200,net_sales:2400,wallet_sales:1700,wallet_refunds:250,wallet_deposits:10000,wallet_ending:8550,prepaid_at_end:8550,debt_at_end:0,wallet_net:8550,cash_sales:1900,cash_refunds_paid:950,cash_net:10950,cash_due_at_end:0,closes:1,close_expected:60950,close_counted:60950,close_variance:0,orders_created:1,open_orders:1,open_drawers:0,funding_requests:0}
 for(const [key,value] of Object.entries(expected))assert.equal(metric(report,key),value,key)
 assert.equal(metric(report,'inventory_ending'),metric(report,'inventory_opening')+metric(report,'inventory_receipts')-metric(report,'inventory_sold')+metric(report,'inventory_returned')+metric(report,'inventory_adjustments'))
 assert.equal(metric(report,'wallet_ending'),metric(report,'wallet_opening')+metric(report,'wallet_net'))
 assert.equal(report.checks.find(c=>c.code==='WALLET_BALANCES').discrepancies,1)
 assert.ok(report.checks.filter(c=>c.code!=='WALLET_BALANCES').every(c=>c.discrepancies===0))
 assert.equal(Number((await owner.query('select balance_won from private.wallets where student_id=$1',[student.student_id])).rows[0].balance_won),8550)
 const cookie=[...accountant].map(([k,v])=>`${k}=${v}`).join('; ')
 const exported=await fetch(ctx.base+`/api/reconciliation/export?day=${day}`,{headers:{cookie}});assert.equal(exported.status,200);assert.match(exported.headers.get('cache-control'),/no-store/)
 const csv=await exported.text();assert.equal(csv.trimEnd().split('\r\n').length,1+report.metrics.length+report.checks.length)
 const after=(await owner.query("select (select md5(string_agg(to_jsonb(l)::text,'' order by l.id)) from private.wallet_ledger l) wallet,(select md5(string_agg(to_jsonb(m)::text,'' order by m.id)) from private.inventory_movements m) inventory,(select md5(string_agg(to_jsonb(e)::text,'' order by e.id)) from private.cash_shift_events e) cash")).rows[0];assert.deepEqual(after,before)
 phase='browser';browser=await chromium.launch({headless:true});const context=await browser.newContext(),page=await context.newPage(),errors=[]
 page.on('pageerror',e=>errors.push(e.message));await context.addCookies([...accountant].filter(([,v])=>v).map(([name,value])=>({name,value,url:ctx.base})))
 await page.goto(ctx.base+'/reconciliation');await expect(page.getByRole('heading',{name:'Recorded data needs reconciliation',exact:true})).toBeVisible()
 await expect(page.getByRole('link',{name:'Export this reconciliation report',exact:true})).toBeVisible()
 fs.mkdirSync('.validation/reconciliation',{recursive:true})
 for(const width of [1440,1024,768,390]){await page.setViewportSize({width,height:900});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await page.screenshot({path:`.validation/reconciliation/report-${width}.png`})}
 assert.deepEqual(errors,[]);await context.close()
 fs.writeFileSync('.validation/reconciliation/results.json',JSON.stringify({expected,checks:report.checks,reportStatus:report.status,financialReadsUnchanged:true,liveDataUsed:false},null,2));console.log('Daily reconciliation passed: mixed wallet/cash/online/partial-refund day, complete export and scoped financial checks.')
}catch(e){fs.mkdirSync('.validation/reconciliation',{recursive:true});fs.writeFileSync('.validation/reconciliation/failure.txt',`Phase: ${phase}\n${e?.stack??'unknown'}`);console.error(`Reconciliation failed at ${phase}: ${e?.message??'unknown'}`);process.exitCode=1}
finally{if(browser)await browser.close();if(ctx)await ctx.close()}
