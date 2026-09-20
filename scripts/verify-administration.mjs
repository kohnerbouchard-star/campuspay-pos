#!/usr/bin/env node
// This acceptance test refuses non-CI and non-local targets through its context.
import assert from 'node:assert/strict'
import { randomInt,randomUUID } from 'node:crypto'
import fs from 'node:fs'
import pg from 'pg'
import { refundTestContext } from './refund-test-context.mjs'
import { runAdministrationBrowser } from './administration-browser.mjs'
let ctx,phase='setup';const checks=[]
try{
 ctx=await refundTestContext();await ctx.start(false)
 const {owner,request,raw,login,staffPin}=ctx
 let admin=await login();let cashier=await login('1001');const accountant=await login('3001'),other=await login('9101'),inventory=await login('2001')
 const readonly=async()=>JSON.stringify((await owner.query("select (select count(*) from private.students) students,(select count(*) from private.wallets) wallets,(select sum(balance_won) from private.wallets) balance,(select count(*) from private.student_cards) cards,(select count(*) from private.student_credentials) pins")).rows[0])
 const before=await readonly(),newPin=String(randomInt(10000000,100000000))
 const common=()=>({requestKey:randomUUID(),adminPin:staffPin,notes:'Synthetic identity and authorized role verified',verified:true})
 const create=()=>({...common(),action:'CREATE_STAFF',employeeCode:'QA-'+randomUUID().slice(0,8),displayName:'Named synthetic staff member',role:'cashier',newPin,confirmationPin:newPin})
 const input=create()
 const snapshot=async()=>request(admin,'/api/administration')
 const profile=async id=>(await snapshot()).staff.find(s=>s.user_id===id)
 const update=async(id,fields={})=>{const s=await profile(id);assert.ok(s);return {...common(),action:'UPDATE_STAFF',targetId:id,displayName:s.display_name,role:s.role,active:s.active,expectedUpdatedAt:s.updated_at,...fields}}
 phase='default-off';await request(admin,'/api/administration',input,403)
 await ctx.start(false,{administration:true,cash:true});admin=await login('9001',admin)
 assert.equal((await snapshot()).enabled,false);await request(admin,'/api/administration',input,409)
 await owner.query('update private.system_settings set administration_enabled=true where singleton')
 for(const role of [cashier,accountant,inventory,new Map()])await request(role,'/api/administration',undefined,role.size?403:401)
 await request(admin,'/api/administration',{...input,verified:false},400)
 await request(admin,'/api/administration',{...input,confirmationPin:'1'+newPin},400)
 await request(admin,'/api/administration',input,403,'https://invalid-origin.example')
 checks.push('application/database gates, role boundaries, explicit confirmation and wrong-origin rejection')
 phase='step-up';await request(admin,'/api/administration',{...input,adminPin:staffPin==='00000000'?'11111111':'00000000'},403)
 assert.equal(Number((await owner.query("select failed_attempts from private.staff_credentials c join public.staff_profiles p on p.auth_user_id=c.staff_user_id where p.employee_code='9001'")).rows[0].failed_attempts),1)
 phase='create-replay';const results=await Promise.all([request(admin,'/api/administration',input),request(admin,'/api/administration',input)])
 assert.deepEqual(results[0],results[1]);const created=results[0];assert.equal(created.outcome,'COMPLETED')
 assert.equal(Number((await owner.query('select count(*) from public.staff_profiles where employee_code=$1',[input.employeeCode])).rows[0].count),1)
 assert.deepEqual(await request(admin,'/api/administration/recover',{requestKey:input.requestKey}),created)
 await request(other,'/api/administration/recover',{requestKey:input.requestKey},403)
 await request(admin,'/api/administration',{...input,displayName:'Changed replay'},409)
 await request(admin,'/api/administration',{...input,requestKey:randomUUID(),employeeCode:input.employeeCode.toLowerCase()},409)
 const credential=(await owner.query('select pin_hash from private.staff_credentials where staff_user_id=$1',[created.target_id])).rows[0].pin_hash
 assert.match(credential,/^\$2[aby]\$12\$/)
 const staffCookies=new Map();await request(staffCookies,'/api/auth/login',{employeeCode:input.employeeCode,pin:newPin})
 checks.push('current-admin PIN failure persists, concurrent create executes once, case collisions and changed/cross-actor replay rejected')
 phase='staff-edit';const edited=await update(created.target_id,{displayName:'Approved synthetic accountant',role:'accountant'})
 const editedResult=await request(admin,'/api/administration',edited);assert.equal(editedResult.sessions_revoked,1)
 await request(staffCookies,'/api/auth/session',undefined,401)
 await request(admin,'/api/administration',{...edited,requestKey:randomUUID()},409)
 await request(staffCookies,'/api/auth/login',{employeeCode:input.employeeCode,pin:newPin})
 const replacement=String(randomInt(10000000,100000000))
 await request(admin,'/api/administration',{...common(),action:'RESET_STAFF_PIN',targetId:created.target_id,newPin:replacement,confirmationPin:replacement})
 await request(staffCookies,'/api/auth/session',undefined,401)
 await request(new Map(),'/api/auth/login',{employeeCode:input.employeeCode,pin:newPin},401)
 await request(staffCookies,'/api/auth/login',{employeeCode:input.employeeCode,pin:replacement})
 await request(admin,'/api/administration',await update(created.target_id,{active:false}))
 await request(staffCookies,'/api/auth/session',undefined,401)
 await request(new Map(),'/api/auth/login',{employeeCode:input.employeeCode,pin:replacement},401)
 const me=(await owner.query("select auth_user_id from public.staff_profiles where employee_code='9001'")).rows[0].auth_user_id
 await request(admin,'/api/administration',{...common(),action:'REVOKE_STAFF_SESSIONS',targetId:me},403)
 await request(admin,'/api/administration',await update(me,{active:false}),403)
 checks.push('stale profile writes rejected, role/PIN/deactivation revoke sessions, old PIN denied and current-admin self-lockout prevented')
 phase='terminal-and-drawer';cashier=await login('1001',cashier)
 const term=(await owner.query("select t.id,t.label,t.active from private.terminals t join private.staff_sessions s on s.terminal_id=t.id join public.staff_profiles p on p.auth_user_id=s.auth_user_id where p.employee_code='1001' and s.revoked_at is null order by s.created_at desc limit 1")).rows[0]
 const terminalInput={...common(),action:'UPDATE_TERMINAL',targetId:term.id,label:'Synthetic checkout terminal',active:false,expectedActive:term.active,expectedLabel:term.label}
 await owner.query('update private.system_settings set cash_controls_enabled=true where singleton')
 const shift=await request(cashier,'/api/cash/open',{requestKey:randomUUID(),counts:{'1000':2},verified:true})
 await request(admin,'/api/administration',terminalInput,409)
 const cashierId=(await owner.query("select auth_user_id from public.staff_profiles where employee_code='1001'")).rows[0].auth_user_id
 await request(admin,'/api/administration',await update(cashierId,{active:false}),409)
 await request(cashier,'/api/cash/close',{requestKey:randomUUID(),shiftId:shift.shift_id,counts:{'1000':2},notes:'Verified synthetic cash count',verified:true})
 await request(admin,'/api/administration',terminalInput)
 await request(cashier,'/api/auth/session',undefined,401)
 await request(cashier,'/api/auth/login',{employeeCode:'1001',pin:staffPin},403)
 const current=(await snapshot()).current_terminal_id
 await request(admin,'/api/administration',{...common(),action:'REVOKE_TERMINAL_SESSIONS',targetId:current},403)
 const currentRecord=(await snapshot()).terminals.find(t=>t.terminal_id===current)
 await request(admin,'/api/administration',{...common(),action:'UPDATE_TERMINAL',targetId:current,label:'Verified current admin terminal',active:true,expectedActive:currentRecord.active,expectedLabel:currentRecord.label})
 await request(admin,'/api/auth/session')
 checks.push('open cash drawers block staff/terminal deactivation; closed terminal revocation denies its old browser and current terminal can be labelled safely')
 phase='recovery-fence';const abandoned=create()
 assert.equal((await request(admin,'/api/administration/recover',{requestKey:abandoned.requestKey})).outcome,'CLOSED')
 assert.equal((await request(admin,'/api/administration',abandoned)).outcome,'CLOSED')
 assert.equal(Number((await owner.query('select count(*) from public.staff_profiles where employee_code=$1',[abandoned.employeeCode])).rows[0].count),0)
 await owner.query('update private.system_settings set administration_enabled=false where singleton')
 assert.deepEqual(await request(admin,'/api/administration/recover',{requestKey:input.requestKey}),created)
 await owner.query('update private.system_settings set administration_enabled=true where singleton')
 const runtime=new pg.Client({connectionString:ctx.runtimeUrl});await runtime.connect()
 try{await assert.rejects(()=>runtime.query('select * from private.administration_operations'),e=>e.code==='42501')}finally{await runtime.end()}
 await assert.rejects(()=>owner.query('update private.administration_operations set result=result'),e=>e.code==='P0001')
 const safe=JSON.stringify((await owner.query("select safe_payload from private.audit_events where event_type='ADMINISTRATION_CHANGED'")).rows)
 for(const secret of [staffPin,newPin,replacement,credential])assert.ok(!safe.includes(secret))
 checks.push('unknown requests are fenced closed, recovery survives shutdown, private records are immutable and audit payloads exclude credential material')
 phase='pagination';await owner.query("insert into public.staff_profiles(employee_code,display_name,role) select 'PAGE-'||lpad(i::text,3,'0'),'Synthetic page fixture '||i,'cashier' from generate_series(1,61) i")
 const first=await snapshot(),second=await request(admin,'/api/administration?staffOffset=50&terminalOffset=0')
 assert.equal(first.staff.length,50);assert.ok(first.staff_total>50);assert.equal(first.staff.length+second.staff.length,first.staff_total)
 assert.equal(new Set([...first.staff,...second.staff].map(x=>x.user_id)).size,first.staff_total)
 assert.equal(await readonly(),before)
 checks.push('directory pagination contains every staff member once and student/card/PIN/wallet state remains unchanged')
 phase='browser';await runAdministrationBrowser(ctx,admin)
 assert.equal(await readonly(),before)
 checks.push('browser administrative creation, lost-response/reload recovery, post-commit refresh error and responsive layouts use synthetic records only')
 fs.mkdirSync('.validation/administration',{recursive:true});fs.writeFileSync('.validation/administration/results.json',JSON.stringify({checks,liveDataUsed:false},null,2))
 console.log(`Administration passed: ${checks.length} acceptance groups; synthetic isolated data only.`)
}catch(e){fs.mkdirSync('.validation/administration',{recursive:true});fs.writeFileSync('.validation/administration/failure.txt',`Phase: ${phase}\n${e?.stack??'unknown'}`);console.error(`Administration test failed at ${phase}: ${e?.message??'unknown'}`);process.exitCode=1}
finally{if(ctx)await ctx.close()}
