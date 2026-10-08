import assert from 'node:assert/strict'
import { randomBytes, randomUUID } from 'node:crypto'
import pg from 'pg'
const token=()=>randomBytes(32).toString('hex')
const loginSql='select * from api.create_staff_session($1,$2,$3,$4,$5)'
export async function auditLoginChecks(ctx,admin,adminSession) {
 const {owner}=ctx,checks=[],clients=[]
 const connect=async()=>{const c=new pg.Client({connectionString:ctx.runtimeUrl});await c.connect();clients.push(c);await c.query("set statement_timeout='5s'");return c}
 const worker=await connect(),control=new pg.Client({connectionString:ctx.ownerUrl});await control.connect()
 const verify=(await owner.query("select pg_get_functiondef('private.verify_pin_proof(text,text)'::regprocedure) definition")).rows[0].definition
 const login=(c,code,proof,fingerprint=token(),ingress=token())=>c.query(loginSql,[code,proof,token(),fingerprint,ingress])
 async function fixture() {
  const code='AUD-'+randomUUID().slice(0,8),proof=token(),fingerprint=token()
  const p=(await owner.query("insert into public.staff_profiles(employee_code,display_name,role) values($1,'Synthetic login actor','cashier') returning *,updated_at::text as updated_at",[code])).rows[0]
  await owner.query("insert into private.staff_credentials(staff_user_id,pin_hash) values($1,extensions.crypt($2,extensions.gen_salt('bf',4)))",[p.auth_user_id,proof])
  const s=(await login(worker,code,proof,fingerprint)).rows[0];assert.ok(s)
  const t=(await owner.query('select * from private.terminals where terminal_fingerprint=$1',[fingerprint])).rows[0]
  return {code,proof,fingerprint,p,s,t}
 }
 async function adminChange(action,id,payload) {
  const r=await owner.query('select * from api.change_administration($1,$2,$3,$4,$5,$6,$7)',[adminSession.session_id,randomUUID(),action,id,JSON.stringify(payload),ctx.staffPinProof(ctx.staffPin),'Synthetic concurrent login administration'])
  assert.equal(r.rows[0].result.outcome,'COMPLETED')
 }
 async function waitForBlock(pid) {
  for(let i=0;i<150;i++){if((await owner.query('select cardinality(pg_blocking_pids($1)) n',[pid])).rows[0].n)return;await new Promise(r=>setTimeout(r,10))}
  throw Error('Verifier did not reach controlled barrier')
 }
 async function race(kind) {
  const f=await fixture(),pausedProof=kind==='unknown'?token():f.proof
  // Test-only wrapper calls the real verifier's bcrypt before a controlled barrier.
  const hooked=verify.replace('return p_hash is not null',`if p_proof='${pausedProof}' then perform pg_advisory_xact_lock(4052299); end if;\n  return p_hash is not null`)
  assert.notEqual(hooked,verify);await owner.query(hooked)
  await control.query('begin');await control.query('select pg_advisory_xact_lock(4052299)')
  const pid=(await worker.query('select pg_backend_pid() pid')).rows[0].pid
  let pending=login(worker,kind==='unknown'?'UNKNOWN-AUDIT':f.code,pausedProof,f.fingerprint).then(r=>r,e=>e)
  try {
   await waitForBlock(pid)
   await owner.query('begin')
   assert.equal((await owner.query("select pg_try_advisory_xact_lock(hashtextextended('campuspay-staff-administration',0)) acquired")).rows[0].acquired,true)
   await owner.query('rollback')
   if(kind==='deactivate')await adminChange('UPDATE_STAFF',f.p.auth_user_id,{display_name:f.p.display_name,role:f.p.role,active:false,expected_updated_at:f.p.updated_at})
   if(kind==='reset')await adminChange('RESET_STAFF_PIN',f.p.auth_user_id,{pin_proof:token()})
   if(kind==='terminal')await adminChange('UPDATE_TERMINAL',f.t.id,{label:'Synthetic disabled terminal',active:false,expected_active:f.t.active,expected_label:f.t.label})
   if(kind==='access') {
    const a=(await owner.query('select * from private.staff_access where user_id=$1',[f.p.auth_user_id])).rows[0]
    const r=await owner.query('select * from api.change_employee_access($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,true)',[adminSession.session_id,randomUUID(),f.p.auth_user_id,a.revision,a.preset,a.permissions,'manager',['inventory.read'],ctx.staffPinProof(ctx.staffPin),'Synthetic concurrent access replacement'])
    assert.equal(r.rows[0].result.outcome,'COMPLETED')
   }
   await control.query('commit');const result=await pending;pending=null
   assert.ok(!result.code,result.message)
   if(kind==='access'){assert.equal(result.rows.length,1);assert.equal(result.rows[0].role,'inventory_admin');assert.deepEqual(result.rows[0].permissions,['inventory.read']);assert.equal(Number(result.rows[0].access_revision),2)}
   else assert.equal(result.rows.length,0,kind)
   checks.push(`Bcrypt holds no global lock; concurrent ${kind} cannot produce a stale session`)
  } finally {await control.query('rollback');if(pending)await pending;await owner.query(verify)}
 }
 try {
  const f=await fixture(),ingress=token()
  assert.equal((await login(worker,f.code,f.proof)).rows.length,1)
  for(let i=0;i<5;i++)assert.equal((await login(worker,f.code,token())).rows.length,0)
  const locked=(await owner.query('select failed_attempts,locked_until>clock_timestamp() locked from private.staff_credentials where staff_user_id=$1',[f.p.auth_user_id])).rows[0]
  assert.deepEqual(locked,{failed_attempts:5,locked:true});assert.equal((await login(worker,f.code,f.proof)).rows.length,0)
  checks.push('Correct PIN works; concurrent-safe failure accounting locks at five attempts and valid PIN cannot bypass lockout')
  assert.equal((await login(worker,'UNKNOWN-AUDIT',token(),token(),ingress)).rows.length,0)
  await owner.query('update private.staff_login_limits set attempts=29 where ingress_fingerprint=$1',[ingress])
  assert.equal((await login(worker,'UNKNOWN-AUDIT',token(),token(),ingress)).rows.length,0)
  assert.equal((await owner.query('select attempts from private.staff_login_limits where ingress_fingerprint=$1',[ingress])).rows[0].attempts,30)
  const good=await fixture()
  assert.equal((await login(worker,good.code,good.proof,token(),ingress)).rows.length,0)
  await owner.query("update private.staff_login_limits set window_started_at=clock_timestamp()-interval '61 seconds' where ingress_fingerprint=$1",[ingress])
  assert.equal((await login(worker,good.code,good.proof,token(),ingress)).rows.length,1)
  checks.push('Unknown identities consume the same trusted ingress budget; limit and window reset are enforced')
  await control.query('begin');await control.query('select pg_advisory_xact_lock(hashtextextended($1,40521))',[ingress])
  await worker.query("set statement_timeout='1s'")
  assert.equal((await login(worker,good.code,good.proof,token(),ingress)).rows.length,0)
  await control.query('rollback')
  checks.push('Concurrent same-ingress requests fail immediately without a waiting connection queue')
  await control.query('begin');await control.query("select pg_advisory_xact_lock(hashtextextended('campuspay-staff-administration',0))")
  assert.equal((await login(worker,good.code,good.proof)).rows.length,0)
  await control.query('rollback')
  checks.push('Busy administration lock returns a uniform empty login without waiting')
  await control.query('begin');await control.query('select id from private.staff_sessions where id=$1 for update',[good.s.session_id])
  assert.equal((await login(worker,good.code,good.proof,good.fingerprint)).rows.length,0)
  await control.query('rollback')
  assert.equal((await owner.query('select revoked_at from private.staff_sessions where id=$1',[good.s.session_id])).rows[0].revoked_at,null)
  checks.push('Busy terminal session preserves the in-flight session and creates no replacement')
  await worker.query("set statement_timeout='5s'")
  for(const kind of ['unknown','deactivate','reset','terminal','access'])await race(kind)
  const unknown=await ctx.raw(new Map(),'/api/auth/login',{employeeCode:'UNKNOWN-HTTP',pin:'12345678'})
  const wrong=await ctx.raw(new Map(),'/api/auth/login',{employeeCode:'9001',pin:'12345678'})
  assert.equal(unknown.status,401);assert.deepEqual(unknown.body,wrong.body)
  checks.push('HTTP known-invalid and unknown-identity failures have identical status and body')
  return checks
 } finally {await control.query('rollback');await owner.query(verify);await control.end();for(const c of clients)await c.end()}
}
