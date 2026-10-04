import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import pg from 'pg'

// Deterministic races in the disposable localhost database, using uncommitted
// card assignments and lifecycle changes rather than timing-dependent requests.
export async function managementConcurrency(ctx,{admin,inventory,accountant,studentId,productId}) {
 const clients=[]
 async function client(){const c=new pg.Client({connectionString:ctx.ownerUrl});await c.connect();clients.push(c);await c.query("set statement_timeout='10s'");return c}
 async function blockedBy(pid,backend){
  const deadline=Date.now()+8000
  while(Date.now()<deadline){
   const rows=(await ctx.owner.query(`select pid,wait_event from pg_stat_activity where $1=any(pg_blocking_pids(pid)) and ($2::int is null or pid=$2)`,[pid,backend??null])).rows
   if(rows.length)return rows[0]
   await new Promise(resolve=>setTimeout(resolve,20))
  }
  throw new Error('Expected transaction lock wait was not observed')
 }
 async function intentRace(table,keyColumn,key,assignment,confirmation){
  const scan=await client(),lifecycle=await client()
  const scanPid=(await scan.query('select pg_backend_pid() pid')).rows[0].pid
  const lifecyclePid=(await lifecycle.query('select pg_backend_pid() pid')).rows[0].pid
  await scan.query('begin')
  await scan.query(assignment.sql,assignment.values)
  await lifecycle.query('begin')
  await lifecycle.query("select pg_advisory_xact_lock(hashtextextended('campuspay-student-lifecycle:'||$1::text,40404))",[studentId])
  await lifecycle.query('select balance_won from private.wallets where student_id=$1 for update',[studentId])
  const submitted=confirmation()
  // Attach immediately so assertion failures cannot create an unhandled rejection.
  const settled=submitted.then(value=>({value}),error=>({error}))
  try{
   const waiting=await blockedBy(scanPid)
   await scan.query('commit')
   const afterAssignment=await blockedBy(lifecyclePid,waiting.pid)
   assert.equal(afterAssignment.wait_event,'advisory',`${table} confirmation must acquire the student's lifecycle lock after waiting for ${keyColumn} ${key}`)
   await lifecycle.query('commit')
   const result=await settled;if(result.error)throw result.error
   return result.value
  }finally{await scan.query('rollback');await lifecycle.query('rollback');await settled}
 }
 try{
  const receipt={supplierName:'Synthetic race supplier',supplierInvoice:randomUUID(),purchaseDate:'2026-10-04',shippingWon:0,otherCostsWon:0,discountWon:0,notes:'Concurrent lifecycle acceptance',lines:[{productId,quantity:2,purchaseUnitCostWon:100}],idempotencyKey:randomUUID()}
  await ctx.request(inventory,'/api/inventory/receipts',receipt,201)
  const payment=await ctx.request(admin,'/api/pos/intents',{items:[{productId,quantity:1}],tenderMode:'WALLET',idempotencyKey:randomUUID()},201)
  const studentCard=(await ctx.owner.query('select id from private.student_cards where student_id=$1 and active',[studentId])).rows[0].id
  const paid=await intentRace('payment_intents','id',payment.intent_id,{
   sql:"update private.payment_intents set student_id=$1,student_card_id=$2,state='awaiting_pin' where id=$3",
   values:[studentId,studentCard,payment.intent_id],
  },()=>ctx.request(admin,`/api/pos/intents/${payment.intent_id}/confirm`,{pin:ctx.pin}))
  assert.ok(paid.sale_id)
  const split=await ctx.request(admin,'/api/pos/intents',{items:[{productId,quantity:1}],tenderMode:'SPLIT',idempotencyKey:randomUUID()},201)
  const finalized=await intentRace('payment_intents','id',split.intent_id,{
   sql:"update private.payment_intents set student_id=$1,student_card_id=$2,state='awaiting_pin' where id=$3",
   values:[studentId,studentCard,split.intent_id],
  },()=>ctx.request(admin,`/api/pos/intents/${split.intent_id}/tender`,{walletAmountWon:split.total_won}))
  assert.equal(finalized.intent_id,split.intent_id)

  await ctx.start(false,{funding:true})
  await ctx.owner.query('update private.system_settings set funding_enabled=true where singleton')
  const fundingKey=randomUUID()
  await ctx.request(accountant,'/api/funding/prepare',{requestKey:fundingKey,action:'NONCASH_CREDIT',denominations:[1000],sourceReference:'Synthetic verified source',notes:'Concurrent funding scan acceptance'})
  const funded=await intentRace('funding_intents','request_key',fundingKey,{
   sql:"update private.funding_intents set student_id=$1,card_id=$2,state='SCANNED' where request_key=$3",
   values:[studentId,studentCard,fundingKey],
  },()=>ctx.request(accountant,'/api/funding/confirm',{requestKey:fundingKey,studentPin:ctx.pin,verified:true,approverCode:'9101',approverPin:ctx.staffPin}))
  assert.equal(funded.outcome,'COMPLETED')
  await ctx.owner.query('update private.system_settings set funding_enabled=false where singleton')
  await ctx.start(false)

  const product=(await ctx.request(inventory,'/api/management',{kind:'PRODUCT',action:'CREATE_PRODUCT',requestKey:randomUUID(),sku:'LOCK-'+randomUUID().slice(0,8),name:'Receipt lifecycle race',category:'QA',sellingPriceWon:1000,reorderLevel:0,reason:'Synthetic receipt archive race',verified:true})).target_id
  const archive=await client(),archivePid=(await archive.query('select pg_backend_pid() pid')).rows[0].pid
  await archive.query('begin')
  await archive.query('select id from public.products where id=$1 for update',[product])
  const receiving=ctx.raw(inventory,'/api/inventory/receipts',{...receipt,lines:[{productId:product,quantity:1,purchaseUnitCostWon:100}],idempotencyKey:randomUUID()})
  const received=receiving.then(value=>({value}),error=>({error}))
  try{
   await blockedBy(archivePid)
   await archive.query('update public.products set active=false,updated_at=clock_timestamp() where id=$1',[product])
   await archive.query('commit')
   const result=await received;if(result.error)throw result.error
   assert.equal(result.value.status,404,'Receipt must recheck active status after a concurrent archive')
   assert.equal(Number((await ctx.owner.query('select count(*) from private.inventory_lots where product_id=$1',[product])).rows[0].count),0)
  }finally{await archive.query('rollback');await received}
  // Balance and stock changes above are synthetic, separate from the browser fixture.
  return 'Payment confirmation, split-tender finalization and funding confirmation wait for card assignment then acquire the lifecycle lock; receiving cannot insert stock after a concurrent archive'
 }finally{for(const c of clients){await c.query('rollback').catch(()=>{});await c.end()}}
}
