// Disposable localhost integration context. No real database connection or school data.
import assert from 'node:assert/strict'
import { createHmac, randomBytes, randomInt, randomUUID } from 'node:crypto'
import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import pg from 'pg'
export async function refundTestContext() {
  assert.equal(process.env.CI, 'true')
  const target = new URL(process.env.DATABASE_URL_UNPOOLED)
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(target.hostname))
  const name = `campuspay_refund_${randomBytes(6).toString('hex')}`
  const role = `cp_refund_${randomBytes(6).toString('hex')}`
  const password = randomBytes(24).toString('hex')
  const staffPin = String(randomInt(10000000, 100000000)), pin = String(randomInt(100000, 1000000))
  const base = 'http://127.0.0.1:3113'
  const env = { ...process.env, NODE_ENV: 'production', COOKIE_SECURE: 'false', APP_ORIGIN: base, STAFF_ORIGIN: '', STORE_ORIGIN: '', DATABASE_URL_UNPOOLED: '', ROSTER_ISSUANCE_ENABLED: 'false', NEXT_TELEMETRY_DISABLED: '1' }
  for (const key of ['CARD_HMAC_SECRET', 'COUPON_HMAC_SECRET', 'STAFF_PIN_PEPPER', 'STUDENT_PIN_PEPPER', 'SESSION_HMAC_SECRET', 'TERMINAL_COOKIE_SECRET']) env[key] = randomBytes(32).toString('hex')
  const h = (key, value) => createHmac('sha256', env[key]).update(value).digest('hex')
  let control, owner, server, fd, created = false, roleCreated = false
  async function stop() {
    if (server) { const child = server; server = null; await new Promise(resolve => { const timer = setTimeout(() => child.kill('SIGKILL'), 5000); child.once('exit', () => { clearTimeout(timer); resolve() }); if (child.exitCode !== null) { clearTimeout(timer); resolve() } else child.kill('SIGTERM') }) }
    if (fd !== undefined) { fs.closeSync(fd); fd = undefined }
  }
  async function close() {
    await stop()
    if (owner) await owner.end()
    if (control) { try { if (created) await control.query(`DROP DATABASE "${name}" WITH (FORCE)`); if (roleCreated) await control.query(`DROP ROLE "${role}"`) } finally { await control.end() } }
  }
  async function start(enabled, { returns = false, cash = false } = {}) {
    await stop()
    fd = fs.openSync('.validation/refunds/server.log', 'a')
    server = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '-p', '3113', '-H', '127.0.0.1'], { env: { ...env, REFUNDS_ENABLED: enabled ? 'true' : 'false', RETURNS_ENABLED: returns ? 'true' : 'false', CASH_CONTROLS_ENABLED: cash ? 'true' : 'false' }, stdio: ['ignore', fd, fd] })
    for (let i = 0; i < 60; i++) { if (server.exitCode !== null) throw new Error('SERVER_EXITED'); try { if ((await fetch(base + '/login')).ok) return } catch {} await new Promise(r => setTimeout(r, 500)) }
    throw new Error('SERVER_START_TIMEOUT')
  }
  async function raw(cookies, path, body, origin = base) {
    const response = await fetch(base + path, { method: body === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json', origin, cookie: [...cookies].map(([key, value]) => `${key}=${value}`).join('; ') }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(20000) })
    for (const value of response.headers.getSetCookie()) { const first = value.split(';')[0], i = first.indexOf('='); cookies.set(first.slice(0, i), first.slice(i + 1)) }
    return { status: response.status, body: await response.json() }
  }
  async function request(cookies, path, body, expected = 200, origin = base) {
    const response = await raw(cookies, path, body, origin)
    assert.equal(response.status, expected, `HTTP status ${path}`); assert.equal(response.body.ok, expected < 400)
    return response.body.ok ? response.body.data : response.body.error
  }
  async function login(code = '9001', cookies = new Map()) { await request(cookies, '/api/auth/login', { employeeCode: code, pin: staffPin }); return cookies }
  try {
    fs.mkdirSync('.validation/refunds', { recursive: true })
    control = new pg.Client({ connectionString: target.href }); await control.connect()
    await control.query(`CREATE DATABASE "${name}"`); created = true; target.pathname = `/${name}`
    const migration = spawnSync(process.execPath, ['scripts/migrate.mjs'], { env: { ...process.env, DATABASE_URL_UNPOOLED: target.href, EXPECTED_DATABASE_HOST: target.hostname }, encoding: 'utf8' })
    assert.equal(migration.status, 0, `Disposable refund migration failed: ${migration.stderr}`)
    owner = new pg.Client({ connectionString: target.href }); await owner.connect()
    await control.query(`CREATE ROLE "${role}" LOGIN PASSWORD '${password}'`); roleCreated = true
    await control.query(`GRANT campuspay_runtime TO "${role}"`)
    const runtime = new URL(target); runtime.username = role; runtime.password = password; env.DATABASE_URL = runtime.href
    const staff = [['1001','cashier'],['2001','inventory_admin'],['3001','accountant'],['9001','super_admin']].map(([employeeCode, staffRole]) => ({ employeeCode, role: staffRole, displayName: `Synthetic ${staffRole}`, pinProof: h('STAFF_PIN_PEPPER', `staff-pin:${staffPin}`) }))
    await owner.query('select * from api.bootstrap_demo($1::jsonb,$2,$3,$4)', [JSON.stringify(staff), h('STUDENT_PIN_PEPPER', `student-pin:${pin}`), h('CARD_HMAC_SECRET', randomBytes(12).toString('hex')), h('COUPON_HMAC_SECRET', 'REFUNDQA')])
    await owner.query("with s as(insert into public.staff_profiles(employee_code,display_name,role) values('9101','Second synthetic refund operator','super_admin') returning auth_user_id) insert into private.staff_credentials(staff_user_id,pin_hash) select auth_user_id,extensions.crypt($1,extensions.gen_salt('bf',12)) from s", [h('STAFF_PIN_PEPPER', `staff-pin:${staffPin}`)])
    return { owner, runtimeUrl: runtime.href, base, start, close, raw, request, login, pin, randomUUID }
  } catch (error) { await close(); throw error }
}
