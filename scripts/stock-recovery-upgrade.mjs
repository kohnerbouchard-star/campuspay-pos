// Forward-upgrade and rollback rehearsal on a second disposable localhost database.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import pg from 'pg'
export async function verifyStockRecoveryUpgrade() {
 assert.equal(process.env.CI,'true')
 const target=new URL(process.env.DATABASE_URL_UNPOOLED);assert.ok(['localhost','127.0.0.1','[::1]'].includes(target.hostname))
 const control=new pg.Client({connectionString:target.href});await control.connect()
 const name='campuspay_stock_upgrade_'+randomBytes(6).toString('hex');let db,created=false
 try {
  await control.query(`create database "${name}"`);created=true;target.pathname='/'+name
  db=new pg.Client({connectionString:target.href});await db.connect()
  await db.query('create schema private; create table private.schema_migrations(version text primary key,applied_at timestamptz not null default now())')
  const final='20261007120000_stock_adjustment_recovery.sql',files=fs.readdirSync('database/migrations').filter(x=>x.endsWith('.sql') && x<=final).sort()
  assert.equal(files.at(-1),final)
  for(const file of files.slice(0,-1)){await db.query('begin');await db.query(fs.readFileSync('database/migrations/'+file,'utf8'));await db.query('insert into private.schema_migrations(version) values($1) on conflict do nothing',[file.slice(0,-4)]);await db.query('commit')}
  const proof=randomBytes(32).toString('hex'),roles=['cashier','inventory_admin','accountant','super_admin']
  const staff=roles.map((role,i)=>({employeeCode:['1001','2001','3001','9001'][i],role,displayName:'Synthetic upgrade '+role,pinProof:proof}))
  await db.query('select * from api.bootstrap_demo($1,$2,$3,$4)',[JSON.stringify(staff),proof,randomBytes(32).toString('hex'),randomBytes(32).toString('hex')])
  const fingerprint=randomBytes(32).toString('hex')
  const login=async()=> (await db.query('select * from api.create_staff_session($1,$2,$3,$4)',['9001',proof,randomBytes(32).toString('hex'),fingerprint])).rows[0]
  const session=await login(),product=(await db.query("select id from public.products where sku='WATER-001'")).rows[0].id,key=randomUUID()
  const args=[session.session_id,product,null,1,'DAMAGED','Synthetic pre-upgrade removal',key]
  await db.query('select * from api.remove_stock($1,$2,$3,$4,$5,$6,$7)',args)
  const snapshot=async()=>{const tables=['stock_adjustments','inventory_movements','audit_events','inventory_lots','wallet_ledger','sales'];const result={};for(const table of tables)result[table]=(await db.query(`select coalesce(jsonb_agg(to_jsonb(t) order by t.id),'[]'::jsonb) data from private.${table} t`)).rows[0].data;return result}
  const before=await snapshot(),body=(await db.query("select prosrc from pg_proc where oid='api.remove_stock(uuid,uuid,uuid,integer,text,text,uuid)'::regprocedure")).rows[0].prosrc
  const sql=fs.readFileSync('database/migrations/'+final,'utf8')
  // A transaction rollback must restore the old function and remove every new object.
  await db.query('begin');await db.query(sql);await db.query('rollback')
  assert.equal((await db.query("select to_regprocedure('api.recover_stock_adjustment(uuid,uuid)') p,to_regclass('private.stock_adjustment_closures') t")).rows[0].p,null)
  assert.equal((await db.query("select to_regclass('private.stock_adjustment_closures') t")).rows[0].t,null)
  assert.deepEqual(await snapshot(),before)
  await db.query('begin');await db.query(sql);await db.query('insert into private.schema_migrations(version) values($1)',[final.slice(0,-4)]);await db.query('commit')
  assert.deepEqual(await snapshot(),before)
  const preserved=(await db.query("select prosrc from pg_proc where oid='private.remove_stock_costed(uuid,uuid,uuid,integer,text,text,uuid)'::regprocedure")).rows[0].prosrc
  assert.equal(preserved,body)
  const fresh=await login(),result=(await db.query('select * from api.recover_stock_adjustment($1,$2)',[fresh.session_id,key])).rows[0].result
  assert.equal(result.state,'POSTED');assert.equal(result.idempotency_key,key)
  await db.query('select * from api.remove_stock($1,$2,$3,$4,$5,$6,$7)',[fresh.session_id,...args.slice(1)])
  assert.deepEqual(await snapshot(),before)
  return {passed:true,forwardOnly:true,historicalRowsUnchanged:true,costingBodySha256:createHash('sha256').update(body).digest('hex'),transactionRollbackPassed:true,preUpgradeResultRecoverable:true}
 } finally {await db?.end();if(created)await control.query(`drop database "${name}" with (force)`);await control.end()}
}
