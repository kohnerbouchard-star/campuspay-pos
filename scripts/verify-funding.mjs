#!/usr/bin/env node
// New operations are exercised only through authenticated APIs in the existing
// CI-only localhost disposable harness. No real school balances or credentials.
import assert from 'node:assert/strict'
import { randomBytes,randomUUID } from 'node:crypto'
import fs from 'node:fs'
import pg from 'pg'
import { refundTestContext } from './refund-test-context.mjs'
import { fundingBrowser } from './funding-browser.mjs'
let ctx,phase='setup';const checks=[]
try{
 ctx=await refundTestContext();assert.match((await ctx.owner.query('select current_database() name')).rows[0].name,/^campuspay_refund_[a-f0-9]{12}$/)
 const {owner,request,login,pin,staffPin}=ctx
 await ctx.start(false);let admin=await login(),accountant=await login('3001');const cashier=await login('1001'),inventory=await login('2001'),other=await login('9101')
 const card='FUND'+randomBytes(12).toString('hex')
 await request(admin,'/api/students',{studentCode:'FUND-'+randomUUID().slice(0,8),displayName:'Synthetic funding student',cardRead:card,pin,confirmationPin:pin,idempotencyKey:randomUUID()},201)
 const day=(await owner.query("select (clock_timestamp() at time zone 'Asia/Seoul')::date::text as business_date")).rows[0].business_date
 const base=()=>({requestKey:randomUUID(),sourceReference:'Verified synthetic source',notes:'Actual isolated funding acceptance record'})
 const deposit=()=>({...base(),action:'CASH_DEPOSIT',denominations:[10000],cashReceivedWon:20000})
 const prepare=(v,who=accountant,status=200)=>request(who,'/api/funding/prepare',v,status)
 const scan=(key,who=accountant)=>request(who,'/api/funding/card',{requestKey:key,cardRead:card})
 const confirm=(key,approval=false,who=accountant,status=200,extra={})=>request(who,'/api/funding/confirm',{requestKey:key,studentPin:pin,verified:true,...(approval?{approverCode:'9001',approverPin:staffPin}:{}),...extra},status)
 const history=(who=accountant,offset=0)=>request(who,`/api/funding?from=${day}&to=${day}&offset=${offset}`)
 const footprint=async()=>(await owner.query('select (select count(*) from private.funding_operations) ops,(select count(*) from private.wallet_ledger) ledger,(select sum(balance_won) from private.wallets) wallets,(select coalesce(sum(amount_won),0) from private.cash_shift_events) cash')).rows[0]
 phase='gates and permissions';await prepare(deposit(),accountant,403)
 await ctx.start(false,{cash:true,funding:true});admin=await login('9001',admin);accountant=await login('3001',accountant)
 await prepare(deposit(),accountant,409)
 await owner.query('update private.system_settings set funding_enabled=true,cash_controls_enabled=true where singleton')
 await prepare(deposit(),cashier,403);await prepare(deposit(),inventory,403);await prepare(deposit(),new Map(),401)
 await request(accountant,'/api/funding/prepare',deposit(),403,'https://wrong-origin.example')
 await prepare({...deposit(),amountWon:1},accountant,400)
 await prepare(deposit(),accountant,409)
 const shift=await request(accountant,'/api/cash/open',{requestKey:randomUUID(),counts:{'50000':1},verified:true})
 checks.push('default-off gates, real role/origin/input boundaries and accountant-owned funding drawer')
 phase='deposit and exact replay';const input=deposit(),intent=await prepare(input);assert.equal(intent.change_won,10000)
 await prepare({...input,notes:'A changed request must conflict'},accountant,409);await scan(input.requestKey)
 const noEffect=await footprint();await confirm(input.requestKey,false,accountant,401,{studentPin:'0000'});assert.deepEqual(await footprint(),noEffect)
 const failed=(await owner.query("select c.failed_attempts from private.student_credentials c join private.students s on s.id=c.student_id where s.display_name='Synthetic funding student'")).rows[0];assert.equal(failed.failed_attempts,1)
 const pair=await Promise.all([confirm(input.requestKey),confirm(input.requestKey)]);assert.deepEqual(pair[0],pair[1]);const first=pair[0].receipt
 assert.equal(first.wallet_delta_won,10000);assert.equal(first.cash_delta_won,10000);assert.equal(first.balance_after_won,10000)
 await request(other,'/api/funding/recover',{requestKey:input.requestKey},403)
 checks.push('deposit plus change, persistent PIN failure, atomic wallet/cash receipt and concurrent replay')
 phase='reviewed corrections and linked reversal';const credit={...base(),action:'NONCASH_CREDIT',denominations:[5000]};await prepare(credit);await scan(credit.requestKey)
 await confirm(credit.requestKey,false,accountant,403)
 await confirm(credit.requestKey,true,accountant,403,{approverCode:'3001'})
 const postedCredit=(await confirm(credit.requestKey,true)).receipt;assert.equal(postedCredit.cash_delta_won,0)
 const debit={...base(),action:'ADMIN_DEBIT',denominations:[1000]};await prepare(debit);await scan(debit.requestKey);assert.equal((await confirm(debit.requestKey,true)).receipt.balance_after_won,14000)
 const excessive={...base(),action:'ADMIN_DEBIT',denominations:[50000]};await prepare(excessive);await scan(excessive.requestKey);const beforeLimit=await footprint();await confirm(excessive.requestKey,true,accountant,409);assert.deepEqual(await footprint(),beforeLimit)
 await request(accountant,'/api/funding/recover',{requestKey:excessive.requestKey})
 const reversal={...base(),action:'REVERSE_FUNDING',originalReference:first.reference_number};await prepare(reversal);await scan(reversal.requestKey)
 const reversed=(await confirm(reversal.requestKey,true)).receipt;assert.equal(reversed.cash_delta_won,-10000);assert.equal(reversed.wallet_delta_won,-10000);assert.equal(reversed.balance_after_won,4000)
 await prepare({...reversal,requestKey:randomUUID()},accountant,409)
 checks.push('independent correction approval, wallet floor and once-only original funding reversal')
 phase='manual cash and close race boundaries'
 for(const [action,counts] of [['PAID_IN',{'5000':1}],['PAID_OUT',{'1000':1}],['CASH_DROP',{'10000':1}]]){const v={...base(),action,counts};await prepare(v);await confirm(v.requestKey,true)}
 const big={...base(),action:'CASH_DROP',counts:{'50000':100}};await prepare(big);const beforeOut=await footprint();await confirm(big.requestKey,true,accountant,409);assert.deepEqual(await footprint(),beforeOut);await request(accountant,'/api/funding/recover',{requestKey:big.requestKey})
 const abandoned=deposit();assert.equal((await request(accountant,'/api/funding/recover',{requestKey:abandoned.requestKey})).outcome,'CLOSED');await prepare(abandoned,accountant,409)
 checks.push('paid-in/out and cash drops affect drawer once; insufficient payouts fail; missing requests fenced closed')
 phase='browser';const browser=await fundingBrowser(ctx,accountant,card)
 checks.push('actual card/PIN browser posting, four widths, committed-response-loss recovery and corrupt-storage guard')
 phase='complete journal and export'
 for(let n=0;n<51;n++){const v={...base(),action:'PAID_IN',counts:{'10':1}};await prepare(v);await confirm(v.requestKey,true)}
 const report=await history(),next=await history(accountant,50);assert.equal(report.rows.length,50);assert.ok(report.total>50);assert.equal(report.rows.length+next.rows.length,report.total)
 assert.equal(new Set([...report.rows,...next.rows].map(r=>r.operation_id)).size,report.total)
 const cookie=[...accountant].map(([k,v])=>`${k}=${v}`).join('; ')
 const exported=await fetch(ctx.base+`/api/funding/export?from=${day}&to=${day}`,{headers:{cookie}});assert.equal(exported.status,200)
 const csv=await exported.text();assert.equal(csv.trimEnd().split('\r\n').length,report.total+1)
 const cashierReport=await history(cashier);assert.equal(cashierReport.finance_access,false);assert.equal(cashierReport.wallets_checked,null);assert.equal(cashierReport.rows.length,0)
 await request(inventory,`/api/funding?from=${day}&to=${day}`,undefined,403)
 const runtime=new pg.Client({connectionString:ctx.runtimeUrl});await runtime.connect();try{await assert.rejects(()=>runtime.query('select * from private.funding_operations'),e=>e.code==='42501')}finally{await runtime.end()}
 assert.equal(Number((await owner.query("select count(*) from private.funding_operations o left join private.wallet_ledger l on l.id=o.ledger_id where o.wallet_delta_won<>0 and (l.id is null or l.amount_won<>o.wallet_delta_won)")).rows[0].count),0)
 checks.push('history beyond 50 rows, full CSV, role-private wallet data and linked-ledger invariants')
 phase='shutdown and original-shift binding';const interrupted=deposit();await prepare(interrupted);await scan(interrupted.requestKey)
 const cashSnapshot=await request(accountant,'/api/cash');let amount=cashSnapshot.current_shift.expected_won
 const counts={};for(const d of [50000,10000,5000,1000,500,100,50,10]){counts[d]=Math.floor(amount/d);amount%=d}assert.equal(amount,0)
 const closed=await request(accountant,'/api/cash/close',{requestKey:randomUUID(),shiftId:shift.shift_id,counts,notes:'Verified physical funding drawer close',verified:true});assert.equal(closed.variance_won,0)
 await confirm(interrupted.requestKey,false,accountant,409)
 await owner.query('update private.system_settings set funding_enabled=false where singleton')
 await ctx.start(false,{cash:true,funding:false});accountant=await login('3001',accountant)
 assert.equal((await request(accountant,'/api/funding/recover',{requestKey:input.requestKey})).outcome,'COMPLETED')
 assert.equal((await request(accountant,'/api/funding/recover',{requestKey:interrupted.requestKey})).outcome,'CLOSED')
 const legacy=await request(accountant,'/api/accounting/intents',{direction:'CREDIT',denominations:[1000],reasonCode:'FUNDS_RECEIVED',notes:'Legacy unclassified funding must fail',idempotencyKey:randomUUID()},201)
 await request(accountant,`/api/accounting/intents/${legacy.intent_id}/card`,{cardRead:card})
 const beforeLegacy=await footprint();await request(accountant,`/api/accounting/intents/${legacy.intent_id}/confirm`,{pin},409);assert.deepEqual(await footprint(),beforeLegacy)
 const final=await history();assert.equal(final.closed_shift_mismatches,0);assert.equal(final.unreviewed_variances,0)
 checks.push('closed original drawer rejects late deposits; shutdown preserves recovery and cannot restore legacy balance edits')
 fs.mkdirSync('.validation/funding',{recursive:true});fs.writeFileSync('.validation/funding/results.json',JSON.stringify({checks,browser,receiptCount:final.total,walletMismatches:final.wallet_mismatches,note:'Existing synthetic demo opening balance is intentionally reported, not silently fixed',liveDataUsed:false},null,2))
 console.log(`Funding passed: ${checks.length} acceptance groups; ${final.total} API-recorded receipts.`)
}catch(e){fs.mkdirSync('.validation/funding',{recursive:true});fs.writeFileSync('.validation/funding/failure.txt',`Phase: ${phase}\n${e?.stack??'unknown'}`);console.error(`Funding failed at ${phase}: ${e?.message??'unknown'}`);process.exitCode=1}
finally{if(ctx)await ctx.close()}
