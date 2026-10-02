// Upgrade rehearsal uses its own disposable localhost database, never Neon.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { randomUUID, createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import pg from 'pg'
const execute = promisify(execFile)
const quote = value => '"' + value.replaceAll('"', '""') + '"'
let control, target, created = false
const name = 'cp_upgrade_' + randomUUID().replaceAll('-', '')
try {
  const source = new URL(process.env.DATABASE_URL_UNPOOLED)
  assert.ok(['localhost', '127.0.0.1'].includes(source.hostname), 'Disposable localhost only')
  const files = fs.readdirSync('database/migrations').filter(file => file.endsWith('.sql')).sort()
  const oldFiles = files.filter(file => file < '20261002040000'), newFiles = files.filter(file => file >= '20261002040000')
  assert.equal(oldFiles.length, 31); assert.equal(newFiles.length, 3)
  control = new pg.Client({ connectionString: source.href }); await control.connect()
  await control.query(`create database ${quote(name)} template template0`); created = true
  source.pathname = '/' + name
  target = new pg.Client({ connectionString: source.href }); await target.connect()
  for (const file of oldFiles) await target.query(fs.readFileSync(path.join('database/migrations', file), 'utf8'))
  const staff = [['1001','cashier'],['2001','inventory_admin'],['3001','accountant'],['9001','super_admin']].map(([employeeCode,role]) => ({ employeeCode, role, displayName: 'Synthetic upgrade ' + role, pinProof: 'a'.repeat(64) }))
  await target.query('select * from api.bootstrap_demo($1::jsonb,$2,$3,$4)', [JSON.stringify(staff), 'b'.repeat(64), 'c'.repeat(64), 'd'.repeat(64)])
  // Reproduce the old installed bootstrap/header discrepancy only in this fixture.
  const legacy = (await target.query("select pg_get_functiondef('api.bootstrap_demo(jsonb,text,text,text)'::regprocedure) body")).rows[0].body
  await target.query(legacy.replaceAll('122000', '85500'))
  await target.query("update private.stock_receipts set purchase_subtotal_won=85500,total_landed_cost_won=85500 where receipt_number='DEMO-RCV-000001'")
  const partial = randomUUID(), roster = randomUUID()
  await target.query("insert into private.students(id,student_code,display_name) values($1,'UPGRADE-PARTIAL','Synthetic partial account'),($2,'UPGRADE-ROSTER','Synthetic roster entry')", [partial, roster])
  await target.query('insert into private.wallets(student_id,balance_won) values($1,0),($2,0)', [partial, roster])
  await target.query("insert into private.student_cards(student_id,card_fingerprint,issued_by) select $1,$2,auth_user_id from public.staff_profiles where employee_code='9001'", [partial, 'e'.repeat(64)])
  const tables = (await target.query("select schemaname,tablename from pg_tables where schemaname in ('private','public') and tablename<>'schema_migrations' order by 1,2")).rows
  async function digest() {
    const rows = []
    for (const table of tables) rows.push({ ...table, ...(await target.query(`select count(*)::integer count,md5(coalesce(string_agg(to_jsonb(t)::text,'' order by to_jsonb(t)::text),'')) digest from ${quote(table.schemaname)}.${quote(table.tablename)} t`)).rows[0] })
    return rows
  }
  const before = await digest()
  // Prove the complete forward DDL can be rolled back without touching old rows.
  await target.query('begin')
  try { for (const file of newFiles) await target.query(fs.readFileSync(path.join('database/migrations', file), 'utf8')) }
  finally { await target.query('rollback') }
  assert.deepEqual(await digest(), before)
  assert.equal((await target.query('select count(*)::integer n from private.schema_migrations')).rows[0].n, 31)
  const env = { ...process.env, DATABASE_URL_UNPOOLED: source.href, EXPECTED_DATABASE_HOST: source.hostname }
  await execute(process.execPath, ['scripts/migrate.mjs'], { env })
  await execute(process.execPath, ['scripts/migrate.mjs', '--preflight', '--check-runtime'], { env })
  assert.deepEqual(await digest(), before)
  const migrations = (await target.query('select version,checksum_sha256 from private.schema_migrations order by version')).rows
  assert.equal(migrations.length, 34)
  assert.equal(migrations.filter(row => row.checksum_sha256 === null).length, 31)
  for (const file of newFiles) assert.equal(migrations.find(row => row.version === file.slice(0,-4)).checksum_sha256, createHash('sha256').update(fs.readFileSync(path.join('database/migrations',file))).digest('hex'))
  assert.equal((await target.query('select private.student_credential_state($1) state',[partial])).rows[0].state,'CARD_ONLY')
  assert.equal((await target.query('select private.student_credential_state($1) state',[roster])).rows[0].state,'ROSTER_ONLY')
  const checks = (await target.query("select private.daily_reconciliation_document(current_date)->'checks' checks")).rows[0].checks
  assert.equal(checks.find(row => row.code === 'RECEIPT_COSTS').discrepancies,1)
  assert.equal((await target.query("select count(*)::integer n from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('private','public') and c.relkind in ('r','p') and has_table_privilege('campuspay_runtime',c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')")).rows[0].n,0)
  fs.mkdirSync('.validation/route-repairs',{recursive:true})
  fs.writeFileSync('.validation/route-repairs/upgrade-results.json',JSON.stringify({passed:true,fixture:'disposable-localhost',fromMigrations:31,toMigrations:34,existingDataTablesPreserved:tables.length,ddlRollbackPreserved:true,historicalChecksumsNotInvented:31,newChecksumsVerified:3,cardOnlyStatePreserved:true,legacyCostMismatchDetected:true,runtimeDirectTableAccess:0,productionDataUsed:false},null,2))
  console.log('PASS: populated 31-migration upgrade and rollback preserve every existing application table; new checksums and legacy discrepancy detection verified')
} catch {console.error('Route upgrade rehearsal failed. No connection values or database row contents were printed.');process.exitCode=1}
finally {
  if(target)await target.end()
  if(created)await control.query(`drop database ${quote(name)} with (force)`)
  if(control)await control.end()
}
