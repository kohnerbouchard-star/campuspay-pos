#!/usr/bin/env node
// Isolated test database only. This script refuses remote hosts.
import assert from 'node:assert/strict'
import { randomBytes, randomUUID, createHmac } from 'node:crypto'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import pg from 'pg'
import { runEnrollmentChecks } from './enrollment-integration.mjs'
import { runOldSchemaCheck } from './old-schema-check.mjs'
import { runRemediationChecks } from './remediation-integration.mjs'
import { runTenderChecks } from './tender-integration-checks.mjs'
import { runVisualQa } from './visual-qa.mjs'
import { runStoreRefreshChecks } from './store-integration.mjs'
const ownerUrl = process.env.DATABASE_URL_UNPOOLED
if (!ownerUrl || !['localhost','127.0.0.1'].includes(new URL(ownerUrl).hostname)) throw new Error('Integration tests require an isolated localhost PostgreSQL database')
const owner = new pg.Client({ connectionString: ownerUrl })
await owner.connect()
const env = { ...process.env, COOKIE_SECURE:'false', APP_ORIGIN:'http://127.0.0.1:3100', NODE_ENV:'production', NEXT_TELEMETRY_DISABLED:'1' }
for (const key of ['CARD_HMAC_SECRET','COUPON_HMAC_SECRET','STAFF_PIN_PEPPER','STUDENT_PIN_PEPPER','SESSION_HMAC_SECRET','TERMINAL_COOKIE_SECRET']) env[key] = randomBytes(32).toString('hex')
const h=(key,s)=>createHmac('sha256',env[key]).update(s).digest('hex')
const staff=[['1001','cashier'],['2001','inventory_admin'],['3001','accountant'],['9001','super_admin']].map(([employeeCode,role])=>({employeeCode,role,displayName:`Test ${role}`,pinProof:h('STAFF_PIN_PEPPER','staff-pin:12345678')}))
await owner.query('select * from api.bootstrap_demo($1::jsonb,$2,$3,$4)',[JSON.stringify(staff),h('STUDENT_PIN_PEPPER','student-pin:112233'),h('CARD_HMAC_SECRET','04A81F92C73180'),h('COUPON_HMAC_SECRET','WELCOME10')])
await owner.query("do $$ begin if not exists(select 1 from pg_roles where rolname='campuspay_ci_runtime') then create role campuspay_ci_runtime login password 'ci-isolated-only'; end if; end $$; grant campuspay_runtime to campuspay_ci_runtime")
const runtimeUrl=new URL(ownerUrl);runtimeUrl.username='campuspay_ci_runtime';runtimeUrl.password='ci-isolated-only';env.DATABASE_URL=runtimeUrl.toString()
const runtime = new pg.Client({connectionString:env.DATABASE_URL});await runtime.connect()
await assert.rejects(runtime.query('select * from private.wallets'),/permission denied/)
await assert.rejects(runtime.query("select * from api.bootstrap_demo('[]',null,null,null)"),/permission denied/)
await runtime.end()
const base='http://127.0.0.1:3100'
const log=fs.openSync('.validation/integration-server.log','w')
const server=spawn(process.execPath,['node_modules/next/dist/bin/next','start','-p','3100','-H','127.0.0.1'],{env,stdio:['ignore',log,log]})
const jar=()=>new Map()
async function request(cookies,path,body,expected=200) {
 if (expected===200 && body!==undefined && ['/api/pos/intents','/api/accounting/intents','/api/inventory/products','/api/inventory/receipts','/api/coupons'].includes(path)) expected=201
 const response=await fetch(base+path,{method:body===undefined?'GET':'POST',headers:{'content-type':'application/json',origin:base,cookie:[...cookies].map(([k,v])=>`${k}=${v}`).join('; ')},body:body===undefined?undefined:JSON.stringify(body)})
 for(const cookie of response.headers.getSetCookie()){const first=cookie.split(';')[0];const i=first.indexOf('=');cookies.set(first.slice(0,i),first.slice(i+1))}
 const payload=await response.json()
 assert.equal(response.status,expected,`${path}: ${JSON.stringify(payload)}`)
 if(expected<400) assert.equal(payload.ok,true,`${path}: ${JSON.stringify(payload)}`)
 return payload.data??payload.error
}
const login=async(code,pin='12345678')=>{const c=jar();await request(c,'/api/auth/login',{employeeCode:code,pin});return c}
const card='04A81F92C73180';let studentPin='112233'
async function pay(c,items,couponCode=null,expected=200){
 const i=await request(c,'/api/pos/intents',{items,couponCode,idempotencyKey:randomUUID()})
 await request(c,`/api/pos/intents/${i.intent_id}/card`,{cardRead:card})
 const r=await request(c,`/api/pos/intents/${i.intent_id}/confirm`,{pin:studentPin},expected)
 return {i,r}
}
try {
 for(let i=0;i<60;i++){try{if((await fetch(base)).ok)break}catch{}await new Promise(r=>setTimeout(r,500));if(i===59)throw new Error('App did not start')}
 await request(jar(),'/api/pos/catalog',undefined,401)
 const crossOrigin = await fetch(base+'/api/auth/login',{method:'POST',headers:{'content-type':'application/json',origin:'https://untrusted.example'},body:JSON.stringify({employeeCode:'1001',pin:'12345678'})});assert.equal(crossOrigin.status,403)
 const cashier=await login('1001'),inventory=await login('2001'),accountant=await login('3001'),superadmin=await login('9001')
 for (const path of [`/api/pos/intents/${randomUUID()}/cancel`, `/api/pos/intents/${randomUUID()}/recover`, `/api/accounting/intents/${randomUUID()}/recover`]) {
  const denied = await fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://untrusted.example', cookie: [...superadmin].map(([key, value]) => `${key}=${value}`).join('; ') }, body: '{}' })
  assert.equal(denied.status, 403, 'Cross-origin recovery and cancellation must be rejected before mutation')
 }
 await request(cashier,'/api/inventory/lots',undefined,403)
 await request(cashier,'/api/accounting/students',undefined,403)
 await request(inventory,'/api/accounting/students',undefined,403)
 await request(accountant,'/api/inventory/products',{sku:'NO',name:'No',category:'X',sellingPriceWon:1,reorderLevel:0},403)
 let catalog=await request(cashier,'/api/pos/catalog');assert.equal(catalog.length,5)
 const sandwich=catalog.find(p=>p.sku==='SANDWICH-001'),water=catalog.find(p=>p.sku==='WATER-001')
 const first=await pay(cashier,[{productId:sandwich.id,quantity:5}]);assert.equal(first.r.balance_after_won,-2500);assert.equal(first.r.cogs_won,12500)
 const duplicate=await request(cashier,`/api/pos/intents/${first.i.intent_id}/confirm`,{pin:studentPin});assert.equal(duplicate.sale_id,first.r.sale_id)
 const denied=await pay(cashier,[{productId:sandwich.id,quantity:10}],null,409);assert.equal(denied.r.code,'WALLET_LIMIT')
 const discounted=await pay(cashier,[{productId:water.id,quantity:5}],'WELCOME10');assert.equal(discounted.r.discount_won,600)
 const couponDenied=await pay(cashier,[{productId:water.id,quantity:1}],'WELCOME10',409);assert.equal(couponDenied.r.code,'COUPON_STUDENT_LIMIT')
 const wallets=await request(accountant,'/api/accounting/students');assert.equal(wallets[0].card_active,true);const sid=wallets[0].student_id
 const a=await request(accountant,'/api/accounting/intents',{direction:'CREDIT',denominations:[20000],reasonCode:'FUNDS_RECEIVED',notes:'Integration test receipt',idempotencyKey:randomUUID()})
 await request(accountant,`/api/accounting/intents/${a.intent_id}/card`,{cardRead:card})
 const ar=await request(accountant,`/api/accounting/intents/${a.intent_id}/confirm`,{pin:studentPin});assert.equal(ar.balance_after_won,12100)
 await request(accountant,'/api/auth/login',{employeeCode:'3001',pin:'12345678'})
 const recoveredAdjustment=await request(accountant,`/api/accounting/intents/${a.intent_id}/recover`,{});assert.equal(recoveredAdjustment.receipt.reference_number,ar.reference_number)
 const foreignAccountant=await login('3001');await request(foreignAccountant,`/api/accounting/intents/${a.intent_id}/recover`,{},403)
 const abandonedAdjustment=await request(accountant,'/api/accounting/intents',{direction:'CREDIT',denominations:[1000],reasonCode:'FUNDS_RECEIVED',notes:'Unsubmitted recovery test',idempotencyKey:randomUUID()})
 assert.equal((await request(accountant,`/api/accounting/intents/${abandonedAdjustment.intent_id}/recover`,{})).state,'cancelled')
 for(const name of ['sales','inventory','wallets','coupons'])assert.ok(Array.isArray(await request(accountant,`/api/reports/${name}`)))
 const prod=await request(inventory,'/api/inventory/products',{sku:'FIFO-CHECK',name:'FIFO check',category:'Test',sellingPriceWon:1000,reorderLevel:0})
 catalog=await request(cashier,'/api/pos/catalog');assert.equal(catalog.find(p=>p.id===prod.reference_id).sold_out,true)
 for(const cost of [100,300])await request(inventory,'/api/inventory/receipts',{supplierName:'Test Supplier',supplierInvoice:randomUUID(),purchaseDate:'2026-09-05',shippingWon:0,otherCostsWon:0,discountWon:0,notes:'Cost lot test',lines:[{productId:prod.reference_id,quantity:2,purchaseUnitCostWon:cost}],idempotencyKey:randomUUID()})
 const fifo=await pay(cashier,[{productId:prod.reference_id,quantity:3}]);assert.equal(fifo.r.cogs_won,500)
 await pay(cashier,[{productId:prod.reference_id,quantity:1}]);catalog=await request(cashier,'/api/pos/catalog');assert.equal(catalog.find(p=>p.id===prod.reference_id).sold_out,true)
 const coupons=await request(inventory,'/api/coupons');assert.equal(coupons[0].discount_type,'PERCENTAGE')
 const fixed=await request(inventory,'/api/coupons',{name:'Fixed test',code:'FIXEDTEST',discountType:'FIXED',fixedAmountWon:100,percentageBps:null,minimumSubtotalWon:0,maxDiscountWon:null,totalRedemptionLimit:10,perStudentLimit:2,startsAt:new Date(Date.now()-60000).toISOString(),endsAt:null,idempotencyKey:randomUUID()})
 await request(inventory,`/api/coupons/${fixed.coupon_id}/deactivate`,{reason:'Test complete'})
 const up=await request(superadmin,'/api/security/step-up',{superAdminEmployeeCode:'9001',superAdminPin:'12345678',purpose:'RESET_STUDENT_PIN',studentId:sid})
 await request(superadmin,`/api/security/students/${sid}/pin-reset`,{authorizationToken:up.authorizationToken,newPin:'445566',confirmationPin:'445566'});studentPin='445566'
 await request(superadmin,`/api/security/students/${sid}/pin-reset`,{authorizationToken:up.authorizationToken,newPin:'445566',confirmationPin:'445566'},403)

 // Customer online store: authenticated catalog, isolated card/PIN session, East-room delivery,
 // shared inventory/wallet/coupons, and staff fulfillment state transitions.
 await request(jar(),'/api/store/catalog',undefined,401)
 await request(jar(),'/api/store/locations',undefined,401)
 const customer=jar();await request(customer,'/api/store/login',{cardNumber:card,pin:studentPin})
 const storeCatalogBefore=await request(customer,'/api/store/catalog');assert.ok(storeCatalogBefore.length>=5)
 const locations=await request(customer,'/api/store/locations')
 const east201=locations.find(l=>l.building==='East Building'&&l.floor===2&&l.room==='201');assert.ok(east201?.orderable)
 assert.deepEqual(locations.filter(l=>l.building==='West Building').map(l=>[l.floor,l.orderable]),[[2,false],[3,false],[4,false]])
 await request(inventory,'/api/coupons',{name:'Online fixed test',code:'ONLINE100',discountType:'FIXED',fixedAmountWon:100,percentageBps:null,minimumSubtotalWon:0,maxDiscountWon:null,totalRedemptionLimit:10,perStudentLimit:1,startsAt:new Date(Date.now()-60000).toISOString(),endsAt:null,idempotencyKey:randomUUID()})
 const customerSession=await request(customer,'/api/store/session');assert.equal(customerSession.student_id,sid)
 await request(customer,'/api/orders',undefined,401)
 const staffOnly=await login('1001');await request(staffOnly,'/api/store/orders',undefined,401)
 const waterBefore=storeCatalogBefore.find(p=>p.id===water.id).stock_on_hand
 const webOrder=await request(customer,'/api/store/orders',{items:[{productId:water.id,quantity:1}],couponCode:'ONLINE100',deliveryLocationId:east201.location_id,deliveryNote:'Integration room delivery',idempotencyKey:randomUUID()},201)
 assert.match(webOrder.order_number,/^WEB-/);assert.equal(webOrder.discount_won,100);assert.equal(webOrder.delivery_room,'201')
 const storeCatalogAfter=await request(customer,'/api/store/catalog');assert.equal(storeCatalogAfter.find(p=>p.id===water.id).stock_on_hand,waterBefore-1)
 let customerOrders=await request(customer,'/api/store/orders');assert.equal(customerOrders[0].order_id,webOrder.order_id);assert.equal(customerOrders[0].status,'PLACED')
 const fulfiller=await login('1001');let staffOrders=await request(fulfiller,'/api/orders');assert.ok(staffOrders.some(o=>o.order_id===webOrder.order_id))
 for(const status of ['PICKING','READY','OUT_FOR_DELIVERY','DELIVERED'])await request(fulfiller,`/api/orders/${webOrder.order_id}/status`,{status})
 customerOrders=await request(customer,'/api/store/orders');assert.equal(customerOrders[0].status,'DELIVERED')
 const reportingAccountant=await login('3001');const salesWithChannel=await request(reportingAccountant,'/api/reports/sales');assert.equal(salesWithChannel.find(r=>r.receipt_number===webOrder.order_number).channel,'ONLINE_STORE')

 await runStoreRefreshChecks({request,jar,login,owner,base,customer,card,studentPin,sid,water,east201,webOrder})
 await runEnrollmentChecks({owner,request,login,jar,catalog: await request(await login('1001'),'/api/pos/catalog'),base})
 if(process.env.CI_BROWSER==='1') await runVisualQa({base,login,request,jar,card,studentPin,owner})
 await runTenderChecks({owner,request,login,jar,card,studentPin})
 await runRemediationChecks({owner,request,login,jar,card,studentPin})
 await runOldSchemaCheck({owner,ownerUrl,env,staff,h})

 // Login attempts must commit even though login is rejected.
 for(let i=0;i<5;i++)await request(jar(),'/api/auth/login',{employeeCode:'2001',pin:'00000000'},401)
 const lock=await owner.query("select failed_attempts,locked_until from private.staff_credentials c join public.staff_profiles s on s.auth_user_id=c.staff_user_id where s.employee_code='2001'");assert.equal(lock.rows[0].failed_attempts,5);assert.ok(lock.rows[0].locked_until)
 await request(jar(),'/api/auth/login',{employeeCode:'2001',pin:'12345678'},401)
 await assert.rejects(owner.query('update private.wallet_ledger set amount_won=amount_won'),/Journal entries cannot be changed/)
 const idle=await login('1001');await new Promise(r=>setTimeout(r,21000));await request(idle,'/api/pos/catalog',undefined,401)
 fs.writeFileSync('.validation/integration-results.json',JSON.stringify({passed:true,checks:['anonymous denial','four role logins','least-privilege denials','negative-balance sale','duplicate prevention','wallet floor','coupon limits','accountant top-up','four reports','costed receipts','FIFO allocation','sold-out status','fixed coupon','coupon deactivation','PIN reset and one-use approval','persistent login lockout','immutable ledger','cashier idle expiry','browser login and POS','customer online store','room delivery directory','shared online inventory and wallet','online coupon redemption','staff fulfillment workflow','sales channel attribution','atomic enrollment and duplicate protection','restricted student permissions','terminal cash policy','exact split tender and change','all-or-nothing rollback injection','POS recovery after reauthentication','KST report boundaries','card-first split preparation without financial writes','server wallet capacity and immutable plan replay','wallet-only switch from split','audited cash end time and stale-browser expiry rejection','missing-RPC error mapping','actual pre-refresh schema compatibility','expired server session cannot be revived']},null,2))
 console.log('PASS: HTTP integration suite, staff POS, customer online store, fulfillment, accounting, inventory, coupons, reset authorization and idle expiry')
} finally {server.kill('SIGTERM');await owner.end();fs.closeSync(log)}
