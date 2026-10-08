import assert from 'node:assert/strict'
import fs from 'node:fs'
import { randomBytes, randomUUID } from 'node:crypto'
import pg from 'pg'
export async function auditUpgradeCheck() {
 assert.equal(process.env.CI,'true')
 const url=new URL(process.env.DATABASE_URL_UNPOOLED);assert.ok(['localhost','127.0.0.1','[::1]'].includes(url.hostname))
 const control=new pg.Client({connectionString:url.href});await control.connect()
 const name='campuspay_audit_upgrade_'+randomBytes(6).toString('hex');let db,created=false
 try {
  await control.query(`create database "${name}"`);created=true;url.pathname='/'+name
  db=new pg.Client({connectionString:url.href});await db.connect()
  const final='20261008070000_refund_login_hardening.sql'
  for(const file of fs.readdirSync('database/migrations').filter(f=>f.endsWith('.sql')&&f<final).sort()){
   await db.query('begin');await db.query(fs.readFileSync('database/migrations/'+file,'utf8'));await db.query('commit')
  }
  const proof=randomBytes(32).toString('hex'),roles=['cashier','inventory_admin','accountant','super_admin']
  const staff=roles.map((role,i)=>({employeeCode:['1001','2001','3001','9001'][i],role,displayName:'Synthetic upgrade actor',pinProof:proof}))
  await db.query('select * from api.bootstrap_demo($1,$2,$3,$4)',[JSON.stringify(staff),proof,randomBytes(32).toString('hex'),randomBytes(32).toString('hex')])
  const s=(await db.query('select * from api.create_staff_session($1,$2,$3,$4)',['9001',proof,randomBytes(32).toString('hex'),randomBytes(32).toString('hex')])).rows[0]
  const product=(await db.query("select id from public.products where sku='WATER-001'")).rows[0].id
  await db.query('select * from api.remove_stock($1,$2,null,1,$3,$4,$5)',[s.session_id,product,'DAMAGED','Synthetic pre-upgrade journal',randomUUID()])
  const snapshot=async()=>{
   const state={}
   for(const table of ['staff_sessions','staff_credentials','system_settings','staff_access','wallets','wallet_ledger','inventory_lots','inventory_movements','stock_adjustments','sale_refunds','refund_tenders','cash_refund_payouts','audit_events'])state[table]=(await db.query(`select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb) value from private.${table} t`)).rows[0].value
   return state
  }
  const before=await snapshot(),sql=fs.readFileSync('database/migrations/'+final,'utf8')
  await db.query('begin');await db.query(sql);await db.query('rollback')
  assert.deepEqual(await snapshot(),before)
  assert.equal((await db.query("select to_regclass('private.staff_login_limits') value")).rows[0].value,null)
  assert.equal((await db.query("select has_function_privilege('campuspay_runtime','api.create_staff_session(text,text,text,text)','EXECUTE') value")).rows[0].value,true)
  await db.query('begin');await db.query(sql);await db.query('commit')
  assert.deepEqual(await snapshot(),before)
  assert.equal((await db.query("select has_function_privilege('campuspay_runtime','api.create_staff_session(text,text,text,text)','EXECUTE') value")).rows[0].value,false)
  assert.equal((await db.query("select has_function_privilege('campuspay_runtime','api.create_staff_session(text,text,text,text,text)','EXECUTE') value")).rows[0].value,true)
  return {rollbackRestoresOldContract:true,forwardUpgradePreservesHistoricalRows:true,flagsCredentialsSessionsAndFinancialJournalsUnchanged:true}
 } finally {await db?.end();if(created)await control.query(`drop database "${name}" with (force)`);await control.end()}
}
