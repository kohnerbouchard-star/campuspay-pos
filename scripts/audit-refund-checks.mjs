import assert from 'node:assert/strict'
import { randomBytes, randomUUID } from 'node:crypto'
import pg from 'pg'
import { auditRefundBrowser } from './audit-refund-browser.mjs'

export async function auditRefundChecks(ctx,admin,session) {
 const {owner,request}=ctx,checks=[]
 const runtime=new pg.Client({connectionString:ctx.runtimeUrl});await runtime.connect()
 const product=(await request(admin,'/api/pos/catalog')).find(p=>p.sku==='WATER-001')
 const term=(await owner.query('select terminal_id from private.staff_sessions where id=$1',[session.session_id])).rows[0].terminal_id
 const other=await ctx.login('9101'),otherSession=await request(other,'/api/auth/session')
 const staff=await ctx.login('1001'),staffSession=await request(staff,'/api/auth/session')
 const issuePermissions=['refunds.read','refunds.issue']
 await owner.query('update private.staff_access set permissions=$1 where user_id=$2',[issuePermissions,staffSession.user_id])
 // A session on the shared register models the authorized issue-only operator.
 await owner.query('update private.staff_sessions set terminal_id=$1 where id=$2',[term,staffSession.session_id])
 staff.set('campuspay_terminal',admin.get('campuspay_terminal'))
 const rawPayout=(s,p)=>runtime.query('select * from api.record_refund_cash_payout($1,$2,$3,$4,$5,true)',[s.session_id,p.refundId,p.idempotencyKey,p.amountWon,p.handoverReference])
 const ready=(s,id,sale=false)=>runtime.query('select * from api.refund_cash_readiness($1,$2,$3)',[s.session_id,sale?null:id,sale?id:null]).then(r=>r.rows[0].result)
 const payload=r=>({refundId:r.refund_id,idempotencyKey:randomUUID(),amountWon:r.cash_due_won,handoverReference:'Synthetic verified cash handover',confirmed:true})
 const refundInput=s=>({saleId:s.sale_id,idempotencyKey:randomUUID(),reasonCode:'CUSTOMER_RETURN',notes:'Synthetic inspected original return',verified:true,items:s.items.map(i=>({sale_item_id:i.sale_item_id,disposition:'RESTOCK'}))})
 async function sale() {
  await request(admin,'/api/pos/payment-policy',{cashEnabled:true,eventName:'Synthetic audit fixture',endsAt:new Date(Date.now()+3600000).toISOString()})
  const i=await request(admin,'/api/pos/intents',{items:[{productId:product.id,quantity:1}],tenderMode:'CASH',idempotencyKey:randomUUID()},201)
  const r=await request(admin,`/api/pos/intents/${i.intent_id}/confirm`,{cashReceivedWon:2000})
  return request(admin,`/api/refunds/sale?reference=${r.sale_id}`)
 }
 const shift=await request(admin,'/api/cash/open',{requestKey:randomUUID(),counts:{'10000':2},verified:true})
 try {
  const s=await sale(),input=refundInput(s)
  assert.equal((await ready(staffSession,s.sale_id,true)).state,'READY')
  assert.equal((await ready(staffSession,s.sale_id,true)).handoff,true)
  const posted=(await request(staff,'/api/refunds',input)).refund
  assert.equal(posted.operator_id,staffSession.user_id);assert.equal(posted.total_won,1200)
  assert.equal((await ready(staffSession,posted.refund_id)).state,'PAYOUT_PERMISSION_REQUIRED')
  await request(staff,'/api/refunds/payout',payload(posted),403)
  const paid=await request(admin,'/api/refunds/payout',payload(posted))
  assert.equal(paid.refund.cash_paid_won,1200)
  const journal=(await owner.query('select staff_user_id,terminal_id from private.cash_refund_payouts where refund_id=$1',[posted.refund_id])).rows[0]
  assert.equal(journal.staff_user_id,session.user_id);assert.equal(journal.terminal_id,term)
  checks.push('Issue-only actor and distinct payout-only authority retain separate journal identities without granting permissions')
  assert.equal((await ready(otherSession,posted.refund_id)).state,'PAID')
  const second=await sale(),refund=(await request(admin,'/api/refunds',refundInput(second))).refund,p=payload(refund)
  assert.equal((await ready(otherSession,refund.refund_id)).state,'WRONG_TERMINAL')
  await request(other,'/api/refunds/payout',p,403)
  checks.push('Wrong-terminal readiness and authoritative payout rejection')
  await owner.query("update private.staff_access set permissions=array['refunds.read','refunds.cash_payout'] where user_id=$1",[staffSession.user_id])
  assert.equal((await ready(staffSession,refund.refund_id)).state,'DRAWER_OWNER_REQUIRED')
  await assert.rejects(rawPayout(staffSession,p),/FORBIDDEN/)
  assert.equal((await owner.query('select count(*)::int n from private.cash_refund_payouts where refund_id=$1',[refund.refund_id])).rows[0].n,0)
  checks.push('Payout permission alone cannot debit another actor’s drawer')
  await owner.query("update private.staff_access set permissions=array['refunds.read','refunds.cash_payout','cash.read','cash.shift.manage','cash.drawer.override'] where user_id=$1",[staffSession.user_id])
  assert.equal((await ready(staffSession,refund.refund_id)).state,'READY')
  const outcomes=await Promise.all([rawPayout(staffSession,p),rawPayout(staffSession,p)])
  assert.deepEqual(outcomes[0].rows,outcomes[1].rows)
  const totals=(await owner.query("select count(*)::int n,sum(e.amount_won)::int amount from private.cash_shift_events e join private.cash_refund_payouts p on p.id=e.source_id where p.refund_id=$1 and e.source_type='REFUND_PAYOUT'",[refund.refund_id])).rows[0]
  assert.deepEqual(totals,{n:1,amount:-1200})
  await assert.rejects(rawPayout(staffSession,{...p,handoverReference:'Different proof'}),/CONFLICT/)
  checks.push('Explicit drawer override, parallel replay and changed-payload denial produce one exact cash event')
  // Create another outstanding refund, then close its shift before payout.
  const third=await sale(),thirdRefund=(await request(admin,'/api/refunds',refundInput(third))).refund
  const closeKey=randomUUID()
  await request(admin,'/api/cash/close',{requestKey:closeKey,shiftId:shift.shift_id,counts:{'10000':2,'1000':1,'100':2},notes:'Synthetic exact close',verified:true})
  assert.equal((await ready(session,thirdRefund.refund_id)).state,'CASH_SHIFT_REQUIRED')
  await request(admin,'/api/refunds/payout',payload(thirdRefund),409)
  assert.equal((await rawPayout(staffSession,p)).rows[0].result.refund.cash_paid_won,1200)
  checks.push('Closed drawer denies new payout while completed payout replay stays available')
  const unposted=refundInput(third)
  // Use a fresh sale created earlier? third is refunded, so use original sale
  // with a new partial fixture below; direct trigger probe rolls back everything.
  await owner.query('begin')
  try {
   await owner.query('savepoint no_drawer')
   await assert.rejects(owner.query("insert into private.refund_tenders(refund_id,original_tender_id,tender_type,amount_won) select $1,id,'CASH',1 from private.sale_tenders where sale_id=$2 and tender_type='CASH'",[thirdRefund.refund_id,unposted.saleId]),/CASH_PAYOUT_UNAVAILABLE/)
   await owner.query('rollback to no_drawer')
  } finally {await owner.query('rollback')}
  checks.push('Authoritative computed cash-leg guard rejects posting without a drawer')
  const reopened=await request(admin,'/api/cash/open',{requestKey:randomUUID(),counts:{'10000':2},verified:true})
  const fourth=await sale(),draft=refundInput(fourth)
  const original=(await owner.query('select permissions from private.staff_access where user_id=$1',[session.user_id])).rows[0].permissions
  await owner.query("update private.staff_access set permissions=array_remove(permissions,'refunds.cash_payout') where user_id=$1",[session.user_id])
  assert.equal((await ready(session,fourth.sale_id,true)).state,'PAYOUT_OPERATOR_REQUIRED')
  await request(admin,'/api/refunds',draft,409)
  assert.equal((await owner.query('select count(*)::int n from private.sale_refunds where sale_id=$1',[fourth.sale_id])).rows[0].n,0)
  await owner.query('update private.staff_access set permissions=$1 where user_id=$2',[original,session.user_id])
  checks.push('Issuance without an eligible drawer payer rolls back the complete refund')
  await owner.query('update private.staff_access set permissions=$1 where user_id=$2',[issuePermissions,staffSession.user_id])
  const allocation=(await owner.query('select c.id from private.sale_cost_allocations c join private.sale_items i on i.id=c.sale_item_id where i.sale_id=$1 limit 1',[fourth.sale_id])).rows[0].id
  const pending=(await request(staff,'/api/refunds/items',{...draft,items:[{original_allocation_id:allocation,restock_quantity:1,write_off_quantity:0}],expectedRefundCount:0})).refund
  assert.equal(pending.scope,'PARTIAL')
  // The close wins while a genuine payout waits on the same shift row.
  const blocker=new pg.Client({connectionString:ctx.ownerUrl});await blocker.connect()
  const worker=new pg.Client({connectionString:ctx.runtimeUrl});await worker.connect()
  const parallelSession=randomUUID()
  await owner.query("insert into private.staff_sessions(id,auth_user_id,employee_code_snapshot,role_snapshot,terminal_id,session_token_hash,access_revision,expires_at) select $1,auth_user_id,employee_code_snapshot,role_snapshot,terminal_id,$2,access_revision,expires_at from private.staff_sessions where id=$3",[parallelSession,randomBytes(32).toString('hex'),session.session_id])
  try {
   await blocker.query('begin')
   await blocker.query('select * from api.close_cash_shift($1,$2,$3,$4,$5,true)',[session.session_id,reopened.shift_id,randomUUID(),JSON.stringify({'10000':2,'1000':1,'100':2}),'Synthetic controlled close'])
   const pid=(await worker.query('select pg_backend_pid() pid')).rows[0].pid
   const p2=payload(pending),response=worker.query('select * from api.record_refund_cash_payout($1,$2,$3,$4,$5,true)',[parallelSession,p2.refundId,p2.idempotencyKey,p2.amountWon,p2.handoverReference]).then(r=>r,e=>e)
   for(let i=0;i<100;i++){if((await owner.query('select cardinality(pg_blocking_pids($1)) n',[pid])).rows[0].n)break;if(i===99)throw Error('Payout did not reach shift lock');await new Promise(r=>setTimeout(r,20))}

   await blocker.query('commit');assert.match((await response).message,/CASH_SHIFT_REQUIRED/)
   assert.equal((await owner.query('select count(*)::int n from private.cash_refund_payouts where refund_id=$1',[pending.refund_id])).rows[0].n,0)
  } finally {await blocker.query('rollback');await blocker.end();await worker.end()}
  checks.push('Native controlled close-versus-payout overlap rejects late cash event')
  for(const sql of ['select * from private.staff_login_limits','select private.cash_refund_gate(null,true)','select * from api.create_staff_session(null,null,null,null)'])await assert.rejects(runtime.query(sql),e=>e.code==='42501')
  checks.push('Runtime cannot read login buckets, execute private gates or call legacy login')
  if(process.env.CI_BROWSER==='1')checks.push(await auditRefundBrowser(ctx,admin,pending))
  return checks
 } finally {await runtime.end()}
}
