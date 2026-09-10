import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import pg from 'pg'

// Prove the real older schema boundary, not only an intercepted error response.
export async function runOldSchemaCheck({ owner, ownerUrl, env, staff, h }) {
  assert.ok(['localhost', '127.0.0.1'].includes(new URL(ownerUrl).hostname))
  const name = `campuspay_old_schema_${randomUUID().replaceAll('-', '')}`
  await owner.query(`create database ${name}`)
  const url = new URL(ownerUrl); url.pathname = `/${name}`
  const old = new pg.Client({ connectionString: url.toString() })
  let server, log
  try {
    await old.connect()
    const migrations = fs.readdirSync('database/migrations').filter(file => file.endsWith('.sql') && file < '20260907090000').sort()
    for (const file of migrations) await old.query(fs.readFileSync(`database/migrations/${file}`, 'utf8'))
    assert.equal((await old.query("select to_regprocedure('api.terminal_payment_policy_v2(uuid)') as rpc")).rows[0].rpc, null)
    await old.query('select * from api.bootstrap_demo($1::jsonb,$2,$3,$4)', [JSON.stringify(staff), h('STUDENT_PIN_PEPPER', 'student-pin:112233'), h('CARD_HMAC_SECRET', '04A81F92C73180'), h('COUPON_HMAC_SECRET', 'WELCOME10')])
    const runtime = new URL(env.DATABASE_URL); runtime.pathname = `/${name}`
    const base = 'http://127.0.0.1:3101'
    log = fs.openSync('.validation/old-schema-server.log', 'w')
    server = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '-p', '3101', '-H', '127.0.0.1'], { env: { ...env, DATABASE_URL: runtime.toString(), DATABASE_URL_UNPOOLED: '', APP_ORIGIN: base }, stdio: ['ignore', log, log] })
    for (let i = 0; i < 60; i++) {
      try { if ((await fetch(base)).ok) break } catch {}
      if (i === 59) throw new Error('Older-schema test app did not start')
      await new Promise(resolve => setTimeout(resolve, 500))
    }
    const login = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json', origin: base }, body: JSON.stringify({ employeeCode: '9001', pin: '12345678' }) })
    assert.equal(login.status, 200)
    const cookie = login.headers.getSetCookie().map(value => value.split(';')[0]).join('; ')
    assert.equal((await fetch(`${base}/api/pos/catalog`, { headers: { cookie } })).status, 200, 'Older database credentials and existing catalog still work')
    const response = await fetch(`${base}/api/pos/payment-policy`, { headers: { cookie } })
    assert.equal(response.status, 503)
    const result = await response.json()
    assert.deepEqual(result, { ok: false, error: { code: 'DATABASE_UPGRADE_REQUIRED', message: 'CampusPay needs a database update before this version can be used.' } })
    fs.writeFileSync('.validation/old-schema-results.json', JSON.stringify({ passed: true, migrations, catalogStatus: 200, paymentPolicyStatus: 503, safeError: result.error }, null, 2))
    console.log('PASS: actual pre-refresh schema authenticates staff and serves catalog, missing payment capability returns a safe database-update error')
  } finally {
    if (server && server.exitCode === null) { const exited = once(server, 'exit'); server.kill('SIGTERM'); await exited }
    if (log !== undefined) fs.closeSync(log)
    await old.end()
    await owner.query(`drop database ${name} with (force)`)
  }
}
