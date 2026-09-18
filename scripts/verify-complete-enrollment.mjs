#!/usr/bin/env node
// Creates and removes only its own disposable localhost database. Never uses Neon or school data.
import assert from 'node:assert/strict'
import { randomBytes, randomUUID, randomInt, createHmac } from 'node:crypto'
import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import pg from 'pg'
import { runCompletionBrowser } from './completion-browser.mjs'

const base='http://127.0.0.1:3112'
const databaseName=`campuspay_completion_${randomBytes(6).toString('hex')}`
const runtimeRole=`cp_completion_${randomBytes(6).toString('hex')}`
const runtimePassword=randomBytes(24).toString('hex')
const staffPin=String(randomInt(10000000,100000000))
const studentPin=String(randomInt(100000,1000000))
const checks=[]
let control,owner,server,logFd,created=false,roleCreated=false,browserArtifacts=[]
let phase='initialize'
const env={...process.env,NODE_ENV:'production',COOKIE_SECURE:'false',APP_ORIGIN:base,STAFF_ORIGIN:'',STORE_ORIGIN:'',NEXT_TELEMETRY_DISABLED:'1',DATABASE_URL_UNPOOLED:''}
for(const key of ['CARD_HMAC_SECRET','COUPON_HMAC_SECRET','STAFF_PIN_PEPPER','STUDENT_PIN_PEPPER','SESSION_HMAC_SECRET','TERMINAL_COOKIE_SECRET'])env[key]=randomBytes(32).toString('hex')
const h=(key,value)=>createHmac('sha256',env[key]).update(value).digest('hex')
const newCard=()=>`ISSUEQA${randomBytes(10).toString('hex').toUpperCase()}`
const cookieHeader=cookies=>[...cookies].map(([key,value])=>`${key}=${value}`).join('; ')
async function request(cookies,path,body,expected=200,origin=base){
 const response=await fetch(base+path,{method:body===undefined?'GET':'POST',headers:{'content-type':'application/json',origin,cookie:cookieHeader(cookies)},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(20000)})
 for(const cookie of response.headers.getSetCookie()){const first=cookie.split(';')[0],i=first.indexOf('=');cookies.set(first.slice(0,i),first.slice(i+1))}
 assert.equal(response.status,expected,`Unexpected HTTP status at ${path}`)
 const result=await response.json()
 assert.equal(result.ok,expected<400)
 return expected<400?result.data:result.error
}
async function login(code='9001'){const cookies=new Map();await request(cookies,'/api/auth/login',{employeeCode:code,pin:staffPin});return cookies}
async function makeRoster(year=10,name='Synthetic completion fixture',balance=0){
 const id=randomUUID(),code=`ISSUE-${randomBytes(8).toString('hex')}`
 await owner.query("insert into private.students(id,student_code,display_name,year_group,academic_year) values($1,$2,$3,$4,'2026-2027')",[id,code,name,year])
 await owner.query('insert into private.wallets(student_id,balance_won) values($1,$2)',[id,balance])
 return {id,code,name,year,balance}
}
const inputFor=(student,extra={})=>({expectedCode:student.code,expectedName:student.name,expectedYear:student.year,expectedAcademicYear:'2026-2027',identityVerified:true,cardRead:newCard(),pin:studentPin,confirmationPin:studentPin,idempotencyKey:randomUUID(),...extra})
const complete=(cookies,student,input,expected=200)=>request(cookies,`/api/students/${student.id}/complete-enrollment`,input,expected)
const recover=(cookies,student,key,expected=200)=>request(cookies,`/api/students/${student.id}/recover-completion`,{idempotencyKey:key},expected)
async function state(student){return (await owner.query('select row_to_json(s) as student,row_to_json(w) as wallet,(select count(*)::int from private.student_cards c where c.student_id=s.id) as cards,(select count(*)::int from private.student_credentials c where c.student_id=s.id) as pins,(select count(*)::int from private.student_enrollments e where e.student_id=s.id) as enrollments,(select count(*)::int from private.wallet_ledger l where l.student_id=s.id) as ledger from private.students s join private.wallets w on w.student_id=s.id where s.id=$1',[student.id])).rows[0]}
async function stopServer(){
 if(server){const child=server;server=null;await new Promise(resolve=>{const timer=setTimeout(()=>child.kill('SIGKILL'),5000);child.once('exit',()=>{clearTimeout(timer);resolve()});if(child.exitCode!==null){clearTimeout(timer);resolve()}else child.kill('SIGTERM')})}
 if(logFd!==undefined){fs.closeSync(logFd);logFd=undefined}
}
async function startServer(enabled){
 await stopServer()
 logFd=fs.openSync(`.validation/completion/server-${enabled?'enabled':'disabled'}.log`,'a')
 server=spawn(process.execPath,['node_modules/next/dist/bin/next','start','-p','3112','-H','127.0.0.1'],{env:{...env,ROSTER_ISSUANCE_ENABLED:enabled?'true':'false'},stdio:['ignore',logFd,logFd]})
 for(let i=0;i<60;i++){if(server.exitCode!==null)throw new Error('SERVER_EXITED');try{if((await fetch(base+'/login')).ok)return}catch{}await new Promise(r=>setTimeout(r,500))}
 throw new Error('SERVER_START_TIMEOUT')
}
try{
 const original=process.env.DATABASE_URL_UNPOOLED
 const target=new URL(original)
 assert.equal(process.env.CI,'true')
 assert.ok(['localhost','127.0.0.1','[::1]'].includes(target.hostname),'Disposable localhost PostgreSQL required')
 fs.mkdirSync('.validation/completion',{recursive:true})
 control=new pg.Client({connectionString:original});await control.connect()
 await control.query(`CREATE DATABASE "${databaseName}"`);created=true
 target.pathname=`/${databaseName}`
 const migrated=spawnSync(process.execPath,['scripts/migrate.mjs'],{env:{...process.env,DATABASE_URL_UNPOOLED:target.href,EXPECTED_DATABASE_HOST:target.hostname},encoding:'utf8'})
 assert.equal(migrated.status,0,'Disposable migration failed')
 owner=new pg.Client({connectionString:target.href});await owner.connect()
 await control.query(`CREATE ROLE "${runtimeRole}" LOGIN PASSWORD '${runtimePassword}'`);roleCreated=true
 await control.query(`GRANT campuspay_runtime TO "${runtimeRole}"`)
 const runtimeUrl=new URL(target);runtimeUrl.username=runtimeRole;runtimeUrl.password=runtimePassword;env.DATABASE_URL=runtimeUrl.href
 const staff=[['1001','cashier'],['2001','inventory_admin'],['3001','accountant'],['9001','super_admin']].map(([employeeCode,role])=>({employeeCode,role,displayName:`Synthetic ${role}`,pinProof:h('STAFF_PIN_PEPPER',`staff-pin:${staffPin}`)}))
 await owner.query('select * from api.bootstrap_demo($1::jsonb,$2,$3,$4)',[JSON.stringify(staff),h('STUDENT_PIN_PEPPER',`student-pin:${studentPin}`),h('CARD_HMAC_SECRET',newCard()),h('COUPON_HMAC_SECRET','SYNTHETICWELCOME')])
 await owner.query("with added as(insert into public.staff_profiles(employee_code,display_name,role) values('9101','Second synthetic issuer','super_admin') returning auth_user_id) insert into private.staff_credentials(staff_user_id,pin_hash) select auth_user_id,extensions.crypt($1,extensions.gen_salt('bf',12)) from added",[h('STAFF_PIN_PEPPER',`staff-pin:${staffPin}`)])
 const first=await makeRoster(10,'Repeated synthetic name'),second=await makeRoster(11,'Repeated synthetic name')
 const originalState=await state(first)
 phase='default-disabled';await startServer(false)
 let admin=await login(),other=await login('9101')
 await complete(admin,first,inputFor(first),403)
 assert.deepEqual(await state(first),originalState);checks.push('default-disabled no issuance')
 phase='authorization';await startServer(true);admin=await login();other=await login('9101')
 const payload=inputFor(first)
 await complete(new Map(),first,payload,401)
 for(const role of ['1001','2001','3001']){const cookies=await login(role);await complete(cookies,first,payload,403);await recover(cookies,first,payload.idempotencyKey,403)}
 await request(admin,`/api/students/${first.id}/complete-enrollment`,payload,403,'https://untrusted.example')
 await request(admin,`/api/students/${first.id}/recover-completion`,{idempotencyKey:payload.idempotencyKey},403,'https://untrusted.example')
 await complete(admin,first,{...payload,identityVerified:false},400)
 await complete(admin,first,{...payload,confirmationPin:`${studentPin}1`},400)
 await complete(admin,first,{...payload,role:'super_admin'},400)
 assert.deepEqual(await state(first),originalState);checks.push('anonymous role origin and input denials')
 phase='identity-checks'
 assert.equal((await complete(admin,first,inputFor(first,{expectedYear:11}))).outcome,'STUDENT_CHANGED')
 assert.equal((await complete(admin,first,inputFor(first,{expectedName:'Different synthetic name'}))).outcome,'STUDENT_CHANGED')
 assert.equal((await complete(admin,first,inputFor(first,{expectedAcademicYear:'2025-2026'}))).outcome,'STUDENT_CHANGED')
 const inactive=await makeRoster();await owner.query('update private.students set active=false where id=$1',[inactive.id])
 assert.equal((await complete(admin,inactive,inputFor(inactive))).outcome,'INACTIVE')
 checks.push('stale metadata and inactive student denial')
 phase='completion-and-replay'
 const receipt=await complete(admin,first,payload);assert.equal(receipt.outcome,'COMPLETED');assert.equal(receipt.student_id,first.id)
 const after=await state(first);assert.deepEqual(after.student,originalState.student);assert.deepEqual(after.wallet,originalState.wallet);assert.equal(after.ledger,originalState.ledger);assert.deepEqual([after.cards,after.pins,after.enrollments],[1,1,1])
 assert.equal((await state(second)).cards,0)
 assert.deepEqual(await complete(admin,first,payload),receipt)
 assert.deepEqual(await recover(await login(),first,payload.idempotencyKey),receipt)
 assert.equal((await recover(other,first,payload.idempotencyKey)).outcome,'IDEMPOTENCY_CONFLICT')
 assert.equal((await recover(admin,second,payload.idempotencyKey)).outcome,'IDEMPOTENCY_CONFLICT')
 assert.equal((await complete(admin,first,{...payload,cardRead:newCard()})).outcome,'IDEMPOTENCY_CONFLICT')
 assert.equal((await complete(admin,first,inputFor(first))).outcome,'ALREADY_ISSUED')
 assert.equal((await complete(admin,second,inputFor(second,{cardRead:payload.cardRead}))).outcome,'CARD_ASSIGNED')
 assert.deepEqual([(await state(second)).cards,(await state(second)).pins],[0,0]);checks.push('same-name identity preserved, atomic issuance, replay and credential conflicts')
 phase='recovery-fence'
 const fenced=await makeRoster(),fencedPayload=inputFor(fenced)
 assert.equal((await recover(admin,fenced,fencedPayload.idempotencyKey)).outcome,'CLOSED')
 assert.equal((await complete(admin,fenced,fencedPayload)).outcome,'CLOSED')
 assert.equal((await recover(other,fenced,fencedPayload.idempotencyKey)).outcome,'IDEMPOTENCY_CONFLICT')
 assert.equal((await state(fenced)).cards,0);checks.push('recovery closes a missing request and fences late issuance')
 phase='concurrency'
 const raced=await makeRoster(),races=await Promise.all([complete(admin,raced,inputFor(raced)),complete(other,raced,inputFor(raced))])
 assert.deepEqual(races.map(r=>r.outcome).sort(),['ALREADY_ISSUED','COMPLETED']);assert.deepEqual([(await state(raced)).cards,(await state(raced)).pins],[1,1])
 const shared=newCard(),left=await makeRoster(),right=await makeRoster()
 const cardRace=await Promise.all([complete(admin,left,inputFor(left,{cardRead:shared})),complete(other,right,inputFor(right,{cardRead:shared}))])
 assert.deepEqual(cardRace.map(r=>r.outcome).sort(),['CARD_ASSIGNED','COMPLETED'])
 const loser=cardRace[0].outcome==='CARD_ASSIGNED'?left:right;assert.deepEqual([(await state(loser)).cards,(await state(loser)).pins],[0,0])
 const same=await makeRoster(),sameInput=inputFor(same),sameResults=await Promise.all([complete(admin,same,sameInput),complete(await login(),same,sameInput)])
 assert.deepEqual(sameResults[0],sameResults[1]);assert.equal((await state(same)).cards,1);checks.push('concurrent same student, same card and identical replay')
 phase='atomic-rollback'
 const rejected=await makeRoster(),rejectedPayload=inputFor(rejected)
 await owner.query(`create function private.completion_qa_reject() returns trigger language plpgsql as $$ begin if new.subject_id='${rejected.id}'::uuid then raise exception 'QA_REJECT'; end if; return new; end; $$; create trigger completion_qa_reject before insert on private.audit_events for each row execute function private.completion_qa_reject()`)
 await complete(admin,rejected,rejectedPayload,500)
 await owner.query('drop trigger completion_qa_reject on private.audit_events; drop function private.completion_qa_reject()')
 assert.deepEqual([(await state(rejected)).cards,(await state(rejected)).pins,(await state(rejected)).enrollments],[0,0,0])
 assert.equal((await recover(admin,rejected,rejectedPayload.idempotencyKey)).outcome,'CLOSED');checks.push('audit failure rolls back card PIN and enrollment')
 phase='existing-wallet-and-legacy'
 const funded=await makeRoster(12,'Synthetic pre-funded fixture',4321),fundedBefore=await state(funded)
 assert.equal((await complete(admin,funded,inputFor(funded))).outcome,'COMPLETED')
 assert.deepEqual((await state(funded)).wallet,fundedBefore.wallet)
 const partial=await makeRoster();await owner.query('insert into private.student_credentials(student_id,pin_hash) values($1,extensions.crypt($2,extensions.gen_salt(\'bf\',12)))',[partial.id,h('STUDENT_PIN_PEPPER',`student-pin:${studentPin}`)])
 assert.equal((await complete(admin,partial,inputFor(partial))).outcome,'ALREADY_ISSUED');checks.push('pre-existing wallet unchanged and partial credential history denied')
 phase='post-issuance-login-and-pos'
 const customer=new Map();await request(customer,'/api/store/login',{cardNumber:payload.cardRead,pin:studentPin})
 assert.equal((await request(customer,'/api/store/session')).student_id,first.id)
 await complete(customer,second,inputFor(second),401)
 const cashier=await login('1001'),catalog=await request(cashier,'/api/pos/catalog'),water=catalog.find(p=>p.sku==='WATER-001')
 const intent=await request(cashier,'/api/pos/intents',{items:[{productId:water.id,quantity:1}],idempotencyKey:randomUUID()},201)
 await request(cashier,`/api/pos/intents/${intent.intent_id}/card`,{cardRead:payload.cardRead})
 const sale=await request(cashier,`/api/pos/intents/${intent.intent_id}/confirm`,{pin:studentPin})
 assert.equal(sale.balance_after_won,-1200);assert.equal((await state(first)).ledger,1)
 assert.deepEqual(await recover(admin,first,payload.idempotencyKey),receipt);checks.push('later student login and POS purchase use the same existing wallet')
 phase='runtime-denial'
 const runtime=new pg.Client({connectionString:runtimeUrl.href});await runtime.connect()
 try{await assert.rejects(runtime.query('select * from private.student_completion_closures'),e=>e.code==='42501');await assert.rejects(runtime.query('select * from private.student_credentials'),e=>e.code==='42501')}finally{await runtime.end()}
 checks.push('runtime still cannot read private credentials or recovery rows')
 phase='browser'
 if(process.env.CI_BROWSER==='1')browserArtifacts=await runCompletionBrowser({base,login,makeRoster,state,newCard,studentPin,request,owner})
 phase='disabled-recovery';await startServer(false);admin=await login()
 assert.deepEqual(await recover(admin,first,payload.idempotencyKey),receipt)
 await complete(admin,second,inputFor(second),403);checks.push('disabling new issuance preserves recovery access')
 phase='finish'
 fs.writeFileSync('.validation/completion/results.json',JSON.stringify({passed:true,checks,browserArtifacts,productionAccess:false},null,2))
 console.log(`Complete enrollment passed: ${checks.length} acceptance groups; synthetic localhost data only.`)
}catch(error){
 console.error(`Complete enrollment test failed at ${phase}. ${/^[0-9A-Z]{5}$/.test(error?.code??'')?error.code:'CHECK_FAILED'}`)
 if(fs.existsSync('.validation/completion'))fs.writeFileSync('.validation/completion/results.json',JSON.stringify({passed:false,phase,checks,productionAccess:false},null,2))
 process.exitCode=1
}finally{
 await stopServer()
 if(owner)await owner.end()
 if(control){
  try{if(created)await control.query(`DROP DATABASE "${databaseName}" WITH (FORCE)`);if(roleCreated)await control.query(`DROP ROLE "${runtimeRole}"`)}catch{console.error('Disposable completion-test cleanup needs inspection.');process.exitCode=1}
  await control.end()
 }
}
