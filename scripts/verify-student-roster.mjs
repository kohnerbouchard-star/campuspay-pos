#!/usr/bin/env node
// Disposable local PostgreSQL only. No real student names or credentials.
import assert from 'node:assert/strict'
import { randomUUID, randomBytes } from 'node:crypto'
import pg from 'pg'

let client
let transaction = false
try {
  const url = process.env.DATABASE_URL_UNPOOLED
  const target = new URL(url)
  assert.equal(process.env.CI, 'true')
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(target.hostname))
  client = new pg.Client({ connectionString: url, connectionTimeoutMillis: 15000 })
  await client.connect()
  await client.query('BEGIN')
  transaction = true
  const owner = randomUUID(), cashier = randomUUID(), terminal = randomUUID(), ownerSession = randomUUID(), cashierSession = randomUUID()
  await client.query("insert into public.staff_profiles(auth_user_id,employee_code,display_name,role) values($1,'ROSTERQA_ADMIN','Roster QA Admin','super_admin'),($2,'ROSTERQA_CASH','Roster QA Cashier','cashier')", [owner, cashier])
  await client.query("insert into private.terminals(id,terminal_fingerprint,label) values($1,$2,'Roster QA terminal')", [terminal, randomBytes(32).toString('hex')])
  for (const [id, actor, code, role] of [[ownerSession,owner,'ROSTERQA_ADMIN','super_admin'],[cashierSession,cashier,'ROSTERQA_CASH','cashier']]) {
    await client.query("insert into private.staff_sessions(id,auth_user_id,employee_code_snapshot,role_snapshot,terminal_id,session_token_hash,access_revision,expires_at) values($1,$2,$3,$4,$5,$6,(select a.revision from private.staff_access a where a.user_id=$2),now()+interval '15 minutes')", [id,actor,code,role,terminal,randomBytes(32).toString('hex')])
  }
  const counts = [[6,18],[7,15],[8,19],[9,24],[10,24],[11,18],[12,17]]
  let ordinal = 0
  for (const [year, count] of counts) {
    for (let i = 0; i < count; i++) {
      ordinal++
      const id = randomUUID()
      const name = (year === 10 || year === 11) && i === 0 ? 'ROSTERQA Repeated' : `ROSTERQA Fixture ${String(ordinal).padStart(3,'0')}`
      await client.query("insert into private.students(id,student_code,display_name,year_group,academic_year) values($1,$2,$3,$4,'2026-2027')", [id,`ROSTERQA-${ordinal}`,name,year])
      await client.query('insert into private.wallets(student_id,balance_won) values($1,0)', [id])
    }
  }
  await client.query('SET LOCAL ROLE campuspay_runtime')
  const search = (query = 'ROSTERQA', year = null, offset = 0, session = ownerSession) => client.query('select * from api.search_students_v2($1,$2,$3,$4)', [session,query,year,offset])
  const pages = await Promise.all([0,50,100].map(offset => search('ROSTERQA',null,offset)))
  assert.deepEqual(pages.map(p => p.rows.length), [50,50,35])
  const all = pages.flatMap(p => p.rows)
  assert.equal(new Set(all.map(r => r.student_id)).size, 135)
  assert.ok(all.every(r => Number(r.total_count) === 135 && Number(r.balance_won) === 0 && !r.card_active && !r.pin_set && r.academic_year === '2026-2027'))
  for (const [year,count] of counts) {
    const result = await search('ROSTERQA',year)
    assert.equal(result.rows.length,count)
    assert.ok(result.rows.every(r => r.year_group === year && Number(r.total_count) === count))
  }
  const duplicates = (await search('ROSTERQA Repeated')).rows
  assert.equal(duplicates.length,2)
  assert.deepEqual(duplicates.map(r => r.year_group),[10,11])
  assert.notEqual(duplicates[0].student_code,duplicates[1].student_code)
  assert.equal((await search('ROSTERQA',null,150)).rows.length,0)
  async function denied(action, code) {
    await client.query('SAVEPOINT expected_failure')
    try { await assert.rejects(action, error => error.code === code) }
    finally { await client.query('ROLLBACK TO SAVEPOINT expected_failure'); await client.query('RELEASE SAVEPOINT expected_failure') }
  }
  await denied(() => search('ROSTERQA',null,0,cashierSession),'P0001')
  await denied(() => search('ROSTERQA',null,0,null),'P0001')
  await denied(() => search('ROSTERQA',14),'P0001')
  await denied(() => search('ROSTERQA',null,-1),'P0001')
  await denied(() => search('x'.repeat(121)),'P0001')
  await denied(() => client.query('select * from private.students limit 1'),'42501')
  await client.query('RESET ROLE')
  await denied(() => client.query("update private.students set year_group=0 where student_code='ROSTERQA-1'"),'23514')
  await denied(() => client.query("update private.students set academic_year='2026-2028' where student_code='ROSTERQA-1'"),'23514')
  const unissued = (await client.query("select count(*) as students, count(c.student_id) as cards, count(p.student_id) as pins from private.students s left join private.student_cards c on c.student_id=s.id left join private.student_credentials p on p.student_id=s.id where s.student_code like 'ROSTERQA-%'" )).rows[0]
  assert.equal(Number(unissued.students),135)
  assert.equal(Number(unissued.cards),0)
  assert.equal(Number(unissued.pins),0)
  await client.query('ROLLBACK')
  transaction = false
  console.log('Roster integration passed: 135 synthetic entries, seven year groups, 50/50/35 paging, duplicate names, zero cards/PINs, role and validation denials. Fixtures rolled back.')
} catch (error) {
  const code = /^[0-9A-Z]{5}$/.test(error?.code ?? '') ? error.code : 'CHECK_FAILED'
  console.error(`Roster integration failed (${code}). No connection values were printed.`)
  process.exitCode = 1
} finally {
  if (client) {
    if (transaction) { try { await client.query('ROLLBACK') } catch { process.exitCode = 1 } }
    try { await client.end() } catch { process.exitCode = 1 }
  }
}
