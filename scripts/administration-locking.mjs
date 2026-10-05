import assert from 'node:assert/strict'
import {randomBytes,randomUUID} from 'node:crypto'
import fs from 'node:fs'
import pg from 'pg'

const signature='api.change_administration(uuid,uuid,text,uuid,jsonb,text,text)'
const changeSql='select * from api.change_administration($1,$2,$3,$4,$5::jsonb,$6,$7)'
const loginSql='select * from api.create_staff_session($1,$2,$3,$4)'
const failure=e=>({ok:false,code:e.code??'UNKNOWN',message:e.message})
const settle=p=>p.then(value=>({ok:true,value}),failure)

export async function runAdministrationLocking(ctx,admin){
 const target=new URL(ctx.ownerUrl)
 assert.ok(['localhost','127.0.0.1','[::1]'].includes(target.hostname))
 assert.match(target.pathname,/^\/campuspay_refund_[a-f0-9]+$/)
 const {owner,request,staffPin}=ctx, evidence=[]
 const actor=await request(admin,'/api/auth/session')
 const proof=ctx.staffPinProof(staffPin)
 const original=(await owner.query('select pg_get_functiondef($1::regprocedure) definition',[signature])).rows[0].definition
 const originalLogin=(await owner.query("select pg_get_functiondef('api.create_staff_session(text,text,text,text)'::regprocedure) definition")).rows[0].definition
 async function fixture(){
  const code='LOCK-'+randomUUID().slice(0,8)
  const created=await request(admin,'/api/administration',{action:'CREATE_STAFF',requestKey:randomUUID(),employeeCode:code,displayName:'Synthetic lock fixture',role:'cashier',preset:'staff',newPin:staffPin,confirmationPin:staffPin,adminPin:staffPin,notes:'Isolated lock-order regression fixture',verified:true})
  const cookies=await ctx.login(code),session=await request(cookies,'/api/auth/session')
  const terminal=(await owner.query('select t.* from private.terminals t join private.staff_sessions s on s.terminal_id=t.id where s.id=$1',[session.session_id])).rows[0]
  const profile=(await owner.query('select updated_at::text from public.staff_profiles where auth_user_id=$1',[created.target_id])).rows[0]
  return {code,cookies,session,terminal,profile}
 }
 async function waitForBlock(pid,blocker){
  const deadline=Date.now()+4000
  while(Date.now()<deadline){
   const row=(await owner.query('select $2::int=any(pg_blocking_pids($1::int)) blocked',[pid,blocker])).rows[0]
   if(row.blocked)return
   await new Promise(r=>setTimeout(r,10))
  }
  throw new Error('Expected database lock overlap was not observed')
 }
 async function runCase(action,{baseline=false,checkout=false,adminFirst=false}={}){
  const f=await fixture(),key=randomUUID()
  const worker=new pg.Client({connectionString:ctx.ownerUrl}),lifecycle=new pg.Client({connectionString:ctx.runtimeUrl})
  await worker.connect();await lifecycle.connect()
  // Bounded failure, not timing-based orchestration: pg_blocking_pids is the barrier.
  await worker.query("set statement_timeout='6s'");await lifecycle.query("set statement_timeout='6s'")
  const wp=(await worker.query('select pg_backend_pid() pid')).rows[0].pid
  const lp=(await lifecycle.query('select pg_backend_pid() pid')).rows[0].pid
  let pending,shiftId,intentId
  try{
   if(checkout){
    shiftId=(await request(f.cookies,'/api/cash/open',{requestKey:randomUUID(),counts:{'1000':2},verified:true})).shift_id
    // Event enablement is a synthetic fixture, not a live control change.
    const terminalAdmin=await ctx.login('9001',new Map(f.cookies))
    await request(terminalAdmin,'/api/pos/payment-policy',{cashEnabled:true,eventName:'Isolated lock test',endsAt:new Date(Date.now()+3600000).toISOString()})
    f.cookies=await ctx.login(f.code,new Map(f.cookies));f.session=await request(f.cookies,'/api/auth/session')
    const catalog=await request(f.cookies,'/api/pos/catalog'),water=catalog.find(p=>p.sku==='WATER-001')
    intentId=(await request(f.cookies,'/api/pos/intents',{items:[{productId:water.id,quantity:1}],tenderMode:'CASH',idempotencyKey:randomUUID()},201)).intent_id
   }
   let payload={},targetId=f.session.user_id
   if(action==='UPDATE_STAFF')payload={display_name:'Approved lock fixture',role:'cashier',active:false,expected_updated_at:f.profile.updated_at}
   if(action==='RESET_STAFF_PIN')payload={pin_proof:proof}
   if(action==='UPDATE_TERMINAL'){targetId=f.terminal.id;payload={label:'Disabled lock fixture',active:false,expected_active:f.terminal.active,expected_label:f.terminal.label}}
   if(action==='REVOKE_TERMINAL_SESSIONS')targetId=f.terminal.id
   const invoke=()=>action==='LOGIN'
    ? lifecycle.query(loginSql,[f.code,proof,randomBytes(32).toString('hex'),f.terminal.terminal_fingerprint])
    : lifecycle.query(changeSql,[actor.session_id,key,action,targetId,JSON.stringify(payload),proof,'Controlled in-flight operation regression'])
   const operate=()=>checkout
    ? worker.query('select * from api.confirm_payment($1,$2,null,10000)',[f.session.session_id,intentId])
    : worker.query('select * from api.open_cash_shift($1,$2,$3::jsonb,true)',[f.session.session_id,randomUUID(),JSON.stringify({'1000':2})])
   let operation,administration
   if(adminFirst){
    await lifecycle.query('begin')
    administration=await settle(invoke());assert.ok(administration.ok,administration.message)
    await worker.query('begin');await worker.query('set local role campuspay_runtime')
    pending=settle(operate());await waitForBlock(wp,lp)
    await lifecycle.query('commit');operation=await pending;pending=null
    await worker.query('rollback')
    assert.equal(operation.ok,false);assert.equal(operation.message,'SESSION_EXPIRED')
    assert.equal(Number((await owner.query('select count(*) from private.cash_shifts where terminal_id=$1',[f.terminal.id])).rows[0].count),0)
   }else{
    await worker.query('begin')
    // Hold the actual first row lock, then execute the real restricted API.
    // No synthetic sleeps/triggers in production code and no mocked settlement.
    await worker.query('select id from private.staff_sessions where id=$1 for update',[f.session.session_id])
    pending=settle(invoke());await waitForBlock(lp,wp)
    await worker.query('set local role campuspay_runtime')
    operation=await settle(operate())
    if(operation.ok)await worker.query('commit');else await worker.query('rollback')
    administration=await pending;pending=null
    if(baseline){
     assert.ok([operation.code,administration.code].includes('40P01'),'The original lock order must reproduce a real PostgreSQL deadlock')
    }else{
     assert.ok(operation.ok,operation.message)
     if(['UPDATE_STAFF','UPDATE_TERMINAL'].includes(action)){
      assert.equal(administration.ok,false);assert.equal(administration.message,'OPEN_CASH_SHIFT')
     }else{
      assert.ok(administration.ok,administration.message)
      assert.equal((await owner.query('select revoked_at is not null revoked from private.staff_sessions where id=$1',[f.session.session_id])).rows[0].revoked,true)
     }
     if(checkout){
      const sales=await owner.query('select s.id from private.sales s where payment_intent_id=$1',[intentId]);assert.equal(sales.rowCount,1)
      const amounts=(await owner.query('select count(*) n,sum(amount_won) total from private.cash_shift_events where shift_id=$1',[shiftId])).rows[0]
      assert.equal(Number(amounts.n),1);assert.equal(Number(amounts.total),1200)
     }else assert.equal(Number((await owner.query('select count(*) from private.cash_shifts where terminal_id=$1',[f.terminal.id])).rows[0].count),1)
    }
   }
   evidence.push({action,baseline,checkout,adminFirst,overlapObserved:true,operation:operation.ok?'COMMITTED':operation.code,administration:administration.ok?'COMMITTED':administration.message})
  }finally{
   await worker.query('rollback').catch(()=>{});await lifecycle.query('rollback').catch(()=>{})
   if(pending)await pending
   await worker.end();await lifecycle.end()
  }
 }
 // Negative controls execute the actual published pre-fix function definitions
 // in this disposable database only, proving these tests detect the defect.
 try{
  const source=fs.readFileSync('database/schema/028_staff_administration.sql','utf8')
  const old=source.slice(source.indexOf('create function api.change_administration('),source.indexOf('\ncreate function api.recover_administration(')).replace('create function','create or replace function')
  await owner.query(old)
  await runCase('UPDATE_STAFF',{baseline:true})
 }finally{await owner.query(original)}
 const loginDrain='  perform 1 from private.staff_sessions ss where ss.terminal_id=(select id from private.terminals where terminal_fingerprint=p_terminal_fingerprint) and ss.revoked_at is null order by ss.id for update;'
 assert.ok(originalLogin.includes(loginDrain),'Forward login session-drain patch must be present')
 try{
  await owner.query(originalLogin.replace(loginDrain,''))
  await runCase('LOGIN',{baseline:true})
 }finally{await owner.query(originalLogin)}
 for(const action of ['UPDATE_STAFF','RESET_STAFF_PIN','REVOKE_STAFF_SESSIONS','UPDATE_TERMINAL','REVOKE_TERMINAL_SESSIONS','LOGIN'])await runCase(action)
 await runCase('UPDATE_STAFF',{checkout:true})
 await runCase('REVOKE_STAFF_SESSIONS',{checkout:true})
 await runCase('UPDATE_STAFF',{adminFirst:true})
 await runCase('REVOKE_TERMINAL_SESSIONS',{adminFirst:true})
 return evidence
}
