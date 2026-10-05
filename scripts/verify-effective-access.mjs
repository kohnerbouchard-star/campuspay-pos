#!/usr/bin/env node
// Native PostgreSQL verification on a newly created CI-only localhost database.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import {randomBytes,randomUUID} from 'node:crypto'
import pg from 'pg'
import {CAPABILITY_NAMES,PRESET_DEFAULTS,setCapability} from '../src/features/auth/capabilities.ts'
assert.equal(process.env.CI,'true');const url=new URL(process.env.DATABASE_URL_UNPOOLED);assert.ok(['localhost','127.0.0.1','[::1]'].includes(url.hostname))
const name='campuspay_access_'+randomBytes(6).toString('hex'),control=new pg.Client({connectionString:url.href}),checks=[]
let db,created=false
const proof=randomBytes(32).toString('hex'),terminal=()=>randomBytes(32).toString('hex'),token=()=>randomBytes(32).toString('hex')
try{
 await control.connect();await control.query(`create database "${name}"`);created=true;url.pathname='/'+name;db=new pg.Client({connectionString:url.href});await db.connect()
 const files=fs.readdirSync('database/migrations').filter(f=>f.endsWith('.sql')).sort(),newFiles=files.filter(f=>f>='20261005090000')
 for(const f of files.filter(f=>!newFiles.includes(f)))await db.query(fs.readFileSync('database/migrations/'+f,'utf8'))
 const people={};for(const [code,role] of [['A-ST','cashier'],['A-MG','inventory_admin'],['A-AC','accountant'],['A-SA','super_admin'],['A-SB','super_admin']]){
  const id=(await db.query('insert into public.staff_profiles(employee_code,display_name,role) values($1,$1,$2) returning auth_user_id',[code,role])).rows[0].auth_user_id;people[code]={id,role};await db.query("insert into private.staff_credentials(staff_user_id,pin_hash) values($1,extensions.crypt($2,extensions.gen_salt('bf',4)))",[id,proof])
 }
 async function login(code){const t=terminal(),k=token();const s=(await db.query('select * from api.create_staff_session($1,$2,$3,$4)',[code,proof,k,t])).rows[0];assert.ok(s);return {...s,token:k,fingerprint:t}}
 const old=await login('A-ST');for(const f of newFiles)await db.query(fs.readFileSync('database/migrations/'+f,'utf8'))
 assert.ok((await db.query('select revoked_at from private.staff_sessions where id=$1',[old.session_id])).rows[0].revoked_at)
 const legacy=JSON.parse(fs.readFileSync('docs/access-baseline/legacy-mapping.json','utf8'))
 for(const person of Object.values(people)){const a=(await db.query('select * from private.staff_access where user_id=$1',[person.id])).rows[0];assert.deepEqual([...a.permissions].sort(),[...legacy[person.role]].sort());assert.equal(Number(a.revision),1)}
 checks.push('Existing roles receive exactly the reviewed semantic mapping, never new preset defaults; all old sessions revoked')
 for(const [preset,p] of Object.entries(PRESET_DEFAULTS)){const a=(await db.query('select permissions from private.access_preset_defaults where preset=$1',[preset])).rows[0];assert.deepEqual(a.permissions,[...p]);assert.equal((await db.query('select private.valid_access($1) valid',[p])).rows[0].valid,true)}
 for(const p of [['wallet.fund'],['inventory.product.manage'],['refunds.issue'],['staff.manage'],['students.read','students.read'],['unknown']])assert.equal((await db.query('select private.valid_access($1) valid',[p])).rows[0].valid,false)
 checks.push('Four preset defaults match UI metadata; undefined, duplicate and missing prerequisite permissions rejected by database')
 await db.query('update private.system_settings set administration_enabled=true,cash_controls_enabled=true,funding_enabled=true where singleton')
 const admin=await login('A-SA'),second=await login('A-SB')
 async function access(s,target,newPreset,p,{pin=proof,key=randomUUID(),reason='Reviewed synthetic access assignment',revision,previousPreset,previousPermissions}={}){
  const a=(await db.query('select * from private.staff_access where user_id=$1',[target])).rows[0]
  return (await db.query('select * from api.change_employee_access($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,true)',[s.session_id,key,target,revision??a.revision,previousPreset??a.preset,previousPermissions??a.permissions,newPreset,p,pin,reason])).rows[0].result
 }
 const oldStaff=await login('A-ST'),staffOrders=setCapability(PRESET_DEFAULTS.staff,'orders.fulfill',true).permissions
 const result=await access(admin,people['A-ST'].id,'staff',staffOrders);assert.equal(result.outcome,'COMPLETED');assert.ok(result.sessions_revoked>=1)
 await assert.rejects(()=>db.query('select * from api.authorize_session($1,$2,null)',[oldStaff.token,oldStaff.fingerprint]),/SESSION_EXPIRED/)
 const staff=await login('A-ST');assert.deepEqual([...staff.permissions].sort(),[...staffOrders].sort());assert.equal(staff.preset,'staff');assert.equal(Number(staff.access_revision),2)
 // Changing preset definition never changes existing employees or their active sessions.
 await db.query("update private.access_preset_defaults set permissions=$1 where preset='staff'",[PRESET_DEFAULTS.manager])
 assert.deepEqual((await db.query('select permissions from private.staff_access where user_id=$1',[people['A-ST'].id])).rows[0].permissions.sort(),[...staffOrders].sort())
 await db.query("update private.access_preset_defaults set permissions=$1 where preset='staff'",[PRESET_DEFAULTS.staff])
 checks.push('Custom Staff + Orders assignment, immutable revision, explicit defaults and immediate old-session rejection')
 for(const [s,target,preset,p] of [[staff,people['A-ST'].id,'super_admin',PRESET_DEFAULTS.super_admin],[staff,people['A-AC'].id,'accountant',PRESET_DEFAULTS.accountant],[admin,people['A-SA'].id,'staff',PRESET_DEFAULTS.staff]])await assert.rejects(()=>access(s,target,preset,p),/FORBIDDEN|SELF_CHANGE_FORBIDDEN/)
 const before=(await db.query('select * from private.staff_access where user_id=$1',[people['A-MG'].id])).rows[0]
 assert.equal((await access(admin,people['A-MG'].id,'manager',PRESET_DEFAULTS.manager,{pin:randomBytes(32).toString('hex')})).outcome,'AUTH_FAILED')
 assert.deepEqual((await db.query('select * from private.staff_access where user_id=$1',[people['A-MG'].id])).rows[0],before)
 await assert.rejects(()=>access(admin,people['A-MG'].id,'manager',PRESET_DEFAULTS.manager,{revision:100}),/CONFLICT/)
 await assert.rejects(()=>access(admin,people['A-MG'].id,'manager',setCapability([],'staff.access.manage',true).permissions),/FORBIDDEN/)
 const managerStatus=setCapability(PRESET_DEFAULTS.manager,'students.status.manage',true).permissions;await access(admin,people['A-MG'].id,'manager',managerStatus)
 const manager=await login('A-MG');assert.ok(manager.permissions.includes('students.status.manage'));assert.ok(!manager.permissions.includes('credentials.reset'));assert.ok(!manager.permissions.includes('wallet.fund'))
 const financial=setCapability(PRESET_DEFAULTS.accountant,'wallet.approve',true).permissions;await access(admin,people['A-AC'].id,'accountant',financial);const accountant=await login('A-AC')
 for(const cap of ['inventory.price.manage','staff.manage','credentials.reset','settings.payments.manage'])await assert.rejects(()=>db.query('select * from api.authorize_session($1,$2,$3)',[accountant.token,accountant.fingerprint,cap]),/FORBIDDEN/)
 for(const cap of ['wallet.correct','staff.access.manage','refunds.issue','settings.payments.manage'])await assert.rejects(()=>db.query('select * from api.authorize_session($1,$2,$3)',[staff.token,staff.fingerprint,cap]),/FORBIDDEN/)
 checks.push('Staff escalation denied; Manager cannot self-promote; customized status access implies no credentials; Accountant has no pricing/staff/security authority')
 // Every installed dual-control workflow rejects the same initiator even when both capability cells are assigned.
 let dualPermissions=setCapability(financial,'wallet.correct',true).permissions
 dualPermissions=setCapability(dualPermissions,'wallet.reverse',true).permissions
 dualPermissions=setCapability(dualPermissions,'credentials.reset',true).permissions
 dualPermissions=setCapability(dualPermissions,'credentials.approve',true).permissions
 await access(admin,people['A-AC'].id,'accountant',dualPermissions);const dual=await login('A-AC')
 const student=(await db.query("insert into private.students(student_code,display_name) values('ACCESS-ONLY-SYNTHETIC','Isolated access student') returning id")).rows[0].id
 await db.query('insert into private.wallets(student_id,balance_won) values($1,0)',[student])
 const card=token();await db.query('insert into private.student_cards(student_id,card_fingerprint,issued_by) values($1,$2,$3)',[student,card,people['A-SA'].id])
 await db.query("insert into private.student_credentials(student_id,pin_hash) values($1,extensions.crypt($2,extensions.gen_salt('bf',4)))",[student,proof])
 const fundingPayload={source_reference:'Verified synthetic source',notes:'Actual isolated dual-control operation',denominations:[1000]}
 async function confirm(key,code){return (await db.query('select * from api.confirm_funding($1,$2,$3,$4,$5,true)',[dual.session_id,key,proof,code,proof])).rows[0].result}
 const correction=randomUUID();await db.query("select * from api.prepare_funding($1,$2,'NONCASH_CREDIT',$3)",[dual.session_id,correction,fundingPayload]);await db.query('select * from api.scan_funding_card($1,$2,$3)',[dual.session_id,correction,card])
 await assert.rejects(()=>confirm(correction,'A-AC'),/FORBIDDEN/);await assert.rejects(()=>confirm(correction,'A-MG'),/FORBIDDEN/)
 const corrected=await confirm(correction,'A-SA');assert.equal(corrected.outcome,'COMPLETED');assert.equal(corrected.receipt.balance_after_won,1000)
 const reversal=randomUUID();await db.query("select * from api.prepare_funding($1,$2,'REVERSE_FUNDING',$3)",[dual.session_id,reversal,{source_reference:'Exact original reference',notes:'Actual isolated approved reversal',original_reference:corrected.receipt.reference_number}]);await db.query('select * from api.scan_funding_card($1,$2,$3)',[dual.session_id,reversal,card])
 await assert.rejects(()=>confirm(reversal,'A-AC'),/FORBIDDEN/);await assert.rejects(()=>confirm(reversal,'A-MG'),/FORBIDDEN/);assert.equal((await confirm(reversal,'A-SA')).receipt.balance_after_won,0)
 const elevationToken=token();const elevationArgs=[dual.session_id,null,proof,'RESET_STUDENT_PIN',student,elevationToken]
 for(const code of ['A-AC','A-MG'])await assert.rejects(()=>db.query('select * from api.create_elevation($1,$2,$3,$4,$5,$6)',[elevationArgs[0],code,...elevationArgs.slice(2)]),/FORBIDDEN/)
 assert.equal((await db.query('select * from api.create_elevation($1,$2,$3,$4,$5,$6)',[elevationArgs[0],'A-SA',...elevationArgs.slice(2)])).rows.length,1)
 await db.query('select * from api.reset_student_pin($1,$2,$3,$4)',[dual.session_id,student,elevationToken,proof])
 await assert.rejects(()=>db.query('select * from api.reset_student_pin($1,$2,$3,$4)',[dual.session_id,student,elevationToken,proof]),/FORBIDDEN/)
 const shift=(await db.query('select * from api.open_cash_shift($1,$2,$3,true)',[dual.session_id,randomUUID(),{'1000':1}])).rows[0].result
 const movement=randomUUID();await db.query("select * from api.prepare_funding($1,$2,'PAID_IN',$3)",[dual.session_id,movement,{source_reference:'Verified synthetic drawer source',notes:'Actual isolated approved cash movement',counts:{'1000':1}}])
 await assert.rejects(()=>confirm(movement,'A-AC'),/FORBIDDEN/);await assert.rejects(()=>confirm(movement,'A-MG'),/FORBIDDEN/);assert.equal((await confirm(movement,'A-SA')).outcome,'COMPLETED')
 const close=(await db.query('select * from api.close_cash_shift($1,$2,$3,$4,$5,true)',[dual.session_id,shift.shift_id,randomUUID(),{'1000':0},'Actual isolated variance requiring independent review'])).rows[0].result
 await assert.rejects(()=>db.query('select * from api.approve_cash_variance($1,$2,$3)',[dual.session_id,close.shift_id,'Self-review is prohibited']),/FORBIDDEN/)
 await assert.rejects(()=>db.query('select * from api.approve_cash_variance($1,$2,$3)',[manager.session_id,close.shift_id,'Unassigned review is prohibited']),/FORBIDDEN/)
 await db.query('select * from api.approve_cash_variance($1,$2,$3)',[admin.session_id,close.shift_id,'Independent review of isolated variance'])
 checks.push('Wallet correction/reversal, credential reset, cash movement and variance review: initiator rejects; separate assigned approver succeeds; unassigned approver rejects')
 // Preserve the final usable access administrator, including credentials and active state.
 await access(admin,people['A-SB'].id,'staff',PRESET_DEFAULTS.staff)
 // Only the remaining administrator is current; direct self changes are always denied.
 await assert.rejects(()=>access(admin,people['A-SA'].id,'staff',PRESET_DEFAULTS.staff),/SELF_CHANGE_FORBIDDEN/)
 await assert.rejects(()=>access(second,people['A-SA'].id,'staff',PRESET_DEFAULTS.staff),/SESSION_EXPIRED|FORBIDDEN/)
 checks.push('Super Admin reductions revoke sessions; current administrator self-lockout is forbidden')
 // True API grants and denial precede record lookup when only a view capability is present.
 await db.query('set role campuspay_runtime')
 for(const [sql,args] of [
  ['select * from api.employee_access($1,$2)',[staff.session_id,people['A-SA'].id]],
  ['select * from api.set_terminal_payment_policy($1,false,null,null)',[staff.session_id]],
  ['select * from api.prepare_student_funding($1,$2,$3,$4)',[staff.session_id,randomUUID(),randomUUID(),{}]],
  ['select * from api.create_wallet_adjustment_intent($1,$2,$3,$4,$5,$6)',[staff.session_id,'CREDIT',[1000],'FUNDS_RECEIVED','Unauthorized synthetic mutation',randomUUID()]],
  ['select * from api.change_record($1,$2,$3,$4,$5,$6,null,$7)',[dual.session_id,randomUUID(),'PRODUCT','CHANGE_PRODUCT_PRICE',randomUUID(),{expected_updated_at:new Date().toISOString(),selling_price_won:1},'Denied unrelated domain']],
  ['select * from api.reset_student_pin($1,$2,$3,$4)',[dual.session_id,randomUUID(),token(),proof]],
 ])await assert.rejects(()=>db.query(sql,args),/FORBIDDEN/)
 for(const table of ['private.staff_access','private.staff_access_events','private.wallets','public.staff_profiles'])await assert.rejects(()=>db.query('select * from '+table),e=>e.code==='42501')
 await db.query('reset role')
 const events=(await db.query('select * from private.staff_access_events order by created_at')).rows;assert.ok(events.length>=4);assert.ok(events.every(e=>e.actor_id!==e.target_id&&e.reason.length>=10&&e.previous_permissions&&e.new_permissions))
 await assert.rejects(()=>db.query('update private.staff_access_events set reason=$1',["Overwrite forbidden"]),/Journal entries cannot be changed/)
 checks.push('Runtime direct tables, hidden APIs and legacy adjustment posting denied; access changes have immutable before/after audit history')
 fs.mkdirSync('.validation/access',{recursive:true});fs.writeFileSync('.validation/access/database.json',JSON.stringify({status:'passed',checks},null,2));console.log('Effective-access database verification passed: '+checks.length+' check groups')
}catch(e){console.error('Effective-access verification failed:',e.message);process.exitCode=1}finally{if(db)await db.end();if(created)await control.query(`drop database "${name}" with (force)`);await control.end()}
