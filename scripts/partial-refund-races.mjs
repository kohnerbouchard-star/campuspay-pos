import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import pg from 'pg'
const sql='select * from api.post_partial_refund($1,$2,$3,$4::jsonb,$5,$6,$7,true,$8)'
export const partialArgs=(session,v)=>[session.session_id,v.saleId,v.idempotencyKey,JSON.stringify(v.items),v.expectedRefundCount,v.reasonCode,v.notes,v.returnReason??null]
export async function verifyPartialRaces(ctx,admin,other,sale,all){
 const a=await ctx.request(admin,'/api/auth/session'),b=await ctx.request(other,'/api/auth/session'),cases=[]
 async function overlap(fullFirst=false){
  const detail=await sale('CASH'),snap=await ctx.request(admin,'/api/refunds/items?reference='+detail.sale_id),v=all(snap)
  const x=new pg.Client({connectionString:ctx.runtimeUrl}),y=new pg.Client({connectionString:ctx.runtimeUrl})
  await x.connect();await y.connect();let pending
  try{
   await x.query("set statement_timeout='8s'");await y.query("set statement_timeout='8s'")
   const xp=(await x.query('select pg_backend_pid() pid')).rows[0].pid,yp=(await y.query('select pg_backend_pid() pid')).rows[0].pid
   const full=(client,s)=>client.query('select * from api.post_sale_refund($1,$2,$3,$4,$5::jsonb,true,$6)',[s.session_id,detail.sale_id,'OTHER','Original full-refund race control',JSON.stringify(detail.items.map(i=>({sale_item_id:i.sale_item_id,disposition:'RESTOCK'}))),randomUUID()])
   await x.query('begin')
   const first=fullFirst?await full(x,a):await x.query(sql,partialArgs(a,v))
   assert.equal(first.rows[0].result.outcome,'COMPLETED')
   pending=(fullFirst?y.query(sql,partialArgs(b,{...v,idempotencyKey:randomUUID()})):full(y,b)).then(v=>({ok:true,v}),e=>({ok:false,code:e.code}))
   const deadline=Date.now()+5000;let blocked=false
   while(Date.now()<deadline){blocked=(await ctx.owner.query('select $2::int=any(pg_blocking_pids($1::int)) blocked',[yp,xp])).rows[0].blocked;if(blocked)break;await new Promise(r=>setTimeout(r,10))}
   assert.ok(blocked,'Actual database overlap required');await x.query('commit')
   const second=await pending;pending=null;assert.ok(second.ok,second.code)
   assert.equal(second.v.rows[0].result.outcome,fullFirst?'STALE_REFUND':'PARTIAL_REFUND_EXISTS')
   assert.equal(Number((await ctx.owner.query('select count(*) from private.sale_refunds where sale_id=$1',[detail.sale_id])).rows[0].count),1)
   cases.push({fullFirst,overlapObserved:true,first:'COMPLETED',second:second.v.rows[0].result.outcome})
  }finally{await x.query('rollback').catch(()=>{});if(pending)await pending;await x.end();await y.end()}
 }
 await overlap(false);await overlap(true)
 const d=await sale('CASH'),s=await ctx.request(admin,'/api/refunds/items?reference='+d.sale_id),v=all(s)
 const results=await Promise.all([ctx.request(admin,'/api/refunds/items',v),ctx.request(other,'/api/refunds/items',{...v,idempotencyKey:randomUUID()})])
 assert.deepEqual(results.map(r=>r.outcome).sort(),['COMPLETED','STALE_REFUND'])
 cases.push({case:'two-partial-commands',outcomes:results.map(r=>r.outcome)})
 return cases
}
