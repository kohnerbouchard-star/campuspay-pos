#!/usr/bin/env node
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { parseEnv } from 'node:util'
import { TARGET, REQUIRED_SECRETS, REQUIRED_APIS, MESSAGES, safeFailure, repairEnvironment, assertNoOverrides, assertTarget, checkRuntime } from './lib/local-readiness.mjs'

const oldURL = `postgresql://${TARGET.role}:npg_FIXTURE_ONLY@${TARGET.legacyHost.replace('.', '-pooler.')}/campuspay?channel_binding=require&sslmode=require`
const fixture = ['# keep this comment', `DATABASE_URL="${oldURL}"`, ...REQUIRED_SECRETS.map(k => `${k}="fixture-${k}-do-not-rotate"`), 'APP_ORIGIN=http://localhost:3000', 'COOKIE_SECURE=false', 'UNRELATED="leave $& alone"', ''].join('\n')
const valid = repairEnvironment(fixture)
function expectCode(fn, code) { assert.throws(fn, error => error.safeCode === code) }
function mockClient({ badRole = false, badAPI = false, queryError = false } = {}) {
  const queries = []
  return { queries, async query(sql, args) {
    queries.push({ sql, args })
    if (sql.includes('FROM pg_roles')) {
      if (queryError) throw Object.assign(new Error('secret=npg_SHOULD_NOT_APPEAR'), { code: '42501' })
      return { rows: [{ database: 'campuspay', wallet_exists: true, api_usage: true, excessive_privileges: badRole, private_table_access: false }] }
    }
    if (sql.includes('unnest')) return { rows: REQUIRED_APIS.map((signature, i) => ({ signature, executable: !(badAPI && i === 0) })) }
    return { rows: [] }
  } }
}
test('legacy endpoint becomes verified main while preserving pooler and password', () => {
  const u = new URL(valid.values.DATABASE_URL)
  assert.equal(u.hostname, TARGET.host.replace('.', '-pooler.'))
  assert.equal(u.password, 'npg_FIXTURE_ONLY')
  assert.equal(u.searchParams.get('channel_binding'), 'require')
  assert.equal(u.searchParams.get('sslmode'), 'verify-full')
})
test('all application secrets and unrelated values remain identical', () => {
  const before = parseEnv(fixture)
  for (const key of [...REQUIRED_SECRETS, 'APP_ORIGIN', 'COOKIE_SECURE', 'UNRELATED']) assert.equal(valid.values[key], before[key])
  assert.ok(valid.text.startsWith('# keep this comment\n'))
})
test('direct endpoint stays direct', () => {
  assert.equal(new URL(repairEnvironment(fixture.replace('-pooler.', '.')).values.DATABASE_URL).hostname, TARGET.host)
})
test('repair is idempotent and writes a database host/name pin', () => {
  assert.equal(repairEnvironment(valid.text).changed, false)
  assert.equal(valid.values.EXPECTED_DATABASE_HOST, TARGET.host)
  assert.equal(valid.values.EXPECTED_DATABASE_NAME, 'campuspay')
})
test('unknown branch is not retargeted', () => expectCode(() => repairEnvironment(fixture.replace(TARGET.legacyHost.split('.')[0], 'ep-another-branch')), 'TARGET_UNRECOGNIZED'))
test('owner login is rejected', () => expectCode(() => repairEnvironment(fixture.replace(TARGET.role, 'campuspay_owner')), 'TARGET_IDENTITY'))
test('wrong database is rejected', () => expectCode(() => repairEnvironment(fixture.replace('/campuspay?', '/neondb?')), 'TARGET_IDENTITY'))
test('duplicate database definitions are rejected', () => expectCode(() => repairEnvironment(`${fixture}DATABASE_URL="${oldURL}"\n`), 'DATABASE_URL_DUPLICATE'))
test('missing secret does not trigger rotation', () => expectCode(() => repairEnvironment(fixture.replace(/^CARD_HMAC_SECRET=.*\n/m, '')), 'SECRETS_MISSING'))
test('invalid URL is rejected without printing its value', () => expectCode(() => repairEnvironment(fixture.replace(oldURL, 'npg_PRIVATE_INVALID')), 'CONFIG_INVALID'))
test('weak SSL overrides are removed in the explicit repair', () => {
  const result = repairEnvironment(fixture.replace('sslmode=require', 'sslmode=no-verify&ssl=false&uselibpqcompat=true&sslrootcert=bad&sslkey=bad&sslcert=bad'))
  assert.doesNotThrow(() => assertTarget(result.values))
})
test('password metacharacters do not become replacement instructions', () => {
  const result = repairEnvironment(fixture.replace('npg_FIXTURE_ONLY', 'test%24%26%40%3A'))
  assert.equal(new URL(result.values.DATABASE_URL).password, 'test%24%26%40%3A')
})
test('export syntax, CRLF, and no terminal newline are accepted', () => {
  const result = repairEnvironment(fixture.trimEnd().replace('DATABASE_URL=', 'export DATABASE_URL =').replaceAll('\n', '\r\n'))
  assert.equal(result.values.CARD_HMAC_SECRET, valid.values.CARD_HMAC_SECRET)
  assert.equal(repairEnvironment(result.text).changed, false)
})
test('conflicting shell database URL is blocked', () => expectCode(() => assertNoOverrides(valid.values, { DATABASE_URL: oldURL }), 'ENV_OVERRIDE'))
test('higher precedence Next development file is checked', () => expectCode(() => assertNoOverrides(valid.values, {}, { DATABASE_URL: oldURL }), 'ENV_OVERRIDE'))
test('conflicting application secret override is blocked', () => expectCode(() => assertNoOverrides(valid.values, { CARD_HMAC_SECRET: 'other' }), 'ENV_OVERRIDE'))
test('identical overrides are accepted', () => assert.doesNotThrow(() => assertNoOverrides(valid.values, { DATABASE_URL: valid.values.DATABASE_URL }, { CARD_HMAC_SECRET: valid.values.CARD_HMAC_SECRET })))
test('pooled and unpooled host pin identities match', () => assert.doesNotThrow(() => assertTarget(valid.values)))
test('health rejects a mismatched host pin', () => expectCode(() => assertTarget({ ...valid.values, EXPECTED_DATABASE_HOST: TARGET.legacyHost }), 'TARGET_MISMATCH'))
test('health rejects weak Neon TLS without silently modifying it', () => expectCode(() => assertTarget({ DATABASE_URL: oldURL }), 'SSL_UNSAFE'))
test('health permits local PostgreSQL integration fixtures', () => assert.doesNotThrow(() => assertTarget({ DATABASE_URL: 'postgresql://test:test@localhost:5432/campuspay' })))
test('healthy runtime executes only metadata reads inside a read-only transaction', async () => {
  const client = mockClient()
  const result = await checkRuntime(client, valid.values)
  assert.equal(result.capabilities, REQUIRED_APIS.length)
  assert.equal(client.queries[0].sql, 'BEGIN READ ONLY')
  assert.equal(client.queries.at(-1).sql, 'ROLLBACK')
  assert.ok(client.queries.find(q => q.sql.includes('c.oid')))
  assert.equal(client.queries.some(q => /FROM private\./i.test(q.sql)), false)
})
test('excessive role privileges fail and roll back', async () => {
  const client = mockClient({ badRole: true })
  await assert.rejects(() => checkRuntime(client, valid.values), e => e.safeCode === 'RUNTIME_PRIVILEGES')
  assert.equal(client.queries.at(-1).sql, 'ROLLBACK')
})
test('missing capability fails and rolls back', async () => {
  const client = mockClient({ badAPI: true })
  await assert.rejects(() => checkRuntime(client, valid.values), e => e.safeCode === 'SCHEMA_CAPABILITIES')
  assert.equal(client.queries.at(-1).sql, 'ROLLBACK')
})
test('database failures are rolled back and redacted', async () => {
  const client = mockClient({ queryError: true })
  try { await checkRuntime(client, valid.values); assert.fail('must reject') }
  catch (error) { assert.equal(safeFailure(error).includes('npg_'), false); assert.ok(safeFailure(error).includes('42501')) }
  assert.equal(client.queries.at(-1).sql, 'ROLLBACK')
})
test('malicious error messages and codes are not printed', () => {
  const output = safeFailure({ code: 'npg_SECRET', safeCode: '__proto__', message: oldURL })
  assert.equal(output.includes('npg_'), false)
  assert.equal(output.includes(oldURL), false)
})
test('all safe codes resolve to fixed messages', () => {
  for (const code of Object.keys(MESSAGES)) assert.equal(safeFailure({ safeCode: code }), `${code}: ${MESSAGES[code]}`)
})

// Real local Git fixtures; no network or database credentials are used.
const cli = fileURLToPath(new URL('./repair-local.mjs', import.meta.url))
function repoFixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'campuspay-repair-test-'))
  const git = args => {
    const result = spawnSync('git', args, { cwd: dir, encoding: 'utf8' })
    assert.equal(result.status, 0, result.stderr)
  }
  git(['init', '-b', 'main'])
  git(['config', 'user.name', 'Repair Test'])
  git(['config', 'user.email', 'fixture@example.invalid'])
  git(['remote', 'add', 'origin', 'https://github.com/kohnerbouchard-star/campuspay-pos.git'])
  fs.writeFileSync(path.join(dir, '.gitignore'), '.env*\nnode_modules/\n')
  fs.writeFileSync(path.join(dir, 'package.json'), '{"name":"campuspay-test-fixture"}')
  git(['add', '.']); git(['commit', '-m', 'fixture'])
  fs.writeFileSync(path.join(dir, '.env.local'), fixture, { mode: 0o600 })
  return dir
}
function invoke(dir) {
  const env = { ...process.env }
  for (const key of ['DATABASE_URL', 'EXPECTED_DATABASE_HOST', 'EXPECTED_DATABASE_NAME', ...REQUIRED_SECRETS]) delete env[key]
  return spawnSync(process.execPath, [cli, '--repo', dir, '--check-only'], { env, encoding: 'utf8' })
}
test('CLI dry-run exits 2 for required repair and leaves config untouched', () => {
  const dir = repoFixture()
  try {
    const result = invoke(dir)
    assert.equal(result.status, 2, result.stderr)
    assert.equal(fs.readFileSync(path.join(dir, '.env.local'), 'utf8'), fixture)
    assert.equal(fs.readdirSync(dir).some(n => n.includes('backup')), false)
    assert.equal((result.stdout + result.stderr).includes('npg_FIXTURE'), false)
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
})
test('CLI dry-run exits 0 when already repaired', () => {
  const dir = repoFixture()
  try { fs.writeFileSync(path.join(dir, '.env.local'), valid.text); const result = invoke(dir); assert.equal(result.status, 0, result.stderr) }
  finally { fs.rmSync(dir, { recursive: true, force: true }) }
})
test('CLI rejects dirty checkout before touching environment', () => {
  const dir = repoFixture()
  try {
    fs.writeFileSync(path.join(dir, 'uncommitted.txt'), 'preserve me')
    const result = invoke(dir)
    assert.equal(result.status, 1)
    assert.ok(result.stderr.includes('REPO_UNSAFE'))
    assert.equal(fs.readFileSync(path.join(dir, '.env.local'), 'utf8'), fixture)
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
})
test('CLI rejects symlink environment file', () => {
  const dir = repoFixture()
  try {
    fs.renameSync(path.join(dir, '.env.local'), path.join(dir, '.env.original'))
    fs.symlinkSync('.env.original', path.join(dir, '.env.local'))
    const result = invoke(dir)
    assert.equal(result.status, 1)
    assert.ok(result.stderr.includes('ENV_FILE_UNSAFE'))
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
})

// Hermetic full repair: real files/Git inspection, mocked network/npm/pg boundaries.
function fullFixture(dir) {
  const bin = fs.mkdtempSync(path.join(os.tmpdir(), 'campuspay-repair-bin-'))
  const actualGit = spawnSync('which', ['git'], { encoding: 'utf8' }).stdout.trim()
  fs.writeFileSync(path.join(bin, 'git'), `#!/bin/sh\ncase "$1" in\nfetch|merge-base|merge) exit 0;;\nrev-list) echo 0; exit 0;;\nesac\nexec "${actualGit}" "$@"\n`, { mode: 0o755 })
  fs.writeFileSync(path.join(bin, 'npm'), '#!/bin/sh\nexit 0\n', { mode: 0o755 })
  fs.mkdirSync(path.join(dir, 'node_modules', 'pg'), { recursive: true })
  fs.writeFileSync(path.join(dir, 'node_modules', 'pg', 'index.js'), `module.exports={Client:class {async connect(){} async end(){} async query(sql,args){
    if(sql.includes('FROM pg_roles'))return {rows:[{database:'campuspay',wallet_exists:true,api_usage:true,excessive_privileges:false,private_table_access:false}]};
    if(sql.includes('unnest'))return {rows:args[0].map(signature=>({signature,executable:process.env.FIXTURE_STALE!=='yes'}))};
    return {rows:[]}; }}}`)
  const env = { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}` }
  for (const key of ['DATABASE_URL', 'EXPECTED_DATABASE_HOST', 'EXPECTED_DATABASE_NAME', ...REQUIRED_SECRETS]) delete env[key]
  return { bin, env }
}
test('full mocked repair preserves secrets and creates a private backup exactly once', () => {
  const dir = repoFixture(); const { bin, env } = fullFixture(dir)
  try {
    const execute = () => spawnSync(process.execPath, [cli, '--repo', dir, '--no-start'], { env, encoding: 'utf8' })
    const first = execute()
    assert.equal(first.status, 0, first.stderr)
    const backups = fs.readdirSync(dir).filter(n => n.startsWith('.env.local.backup-'))
    assert.equal(backups.length, 1)
    assert.equal(fs.readFileSync(path.join(dir, backups[0]), 'utf8'), fixture)
    assert.equal(fs.statSync(path.join(dir, backups[0])).mode & 0o777, 0o600)
    assert.equal(fs.statSync(path.join(dir, '.env.local')).mode & 0o777, 0o600)
    assert.equal(fs.readFileSync(path.join(dir, '.env.local'), 'utf8'), valid.text)
    assert.equal((first.stdout + first.stderr).includes('npg_FIXTURE'), false)
    const second = execute(); assert.equal(second.status, 0, second.stderr)
    assert.equal(fs.readdirSync(dir).filter(n => n.startsWith('.env.local.backup-')).length, 1)
  } finally { fs.rmSync(dir, { recursive: true, force: true }); fs.rmSync(bin, { recursive: true, force: true }) }
})
test('full mocked repair stops on stale API capabilities and retains recovery backup', () => {
  const dir = repoFixture(); const { bin, env } = fullFixture(dir)
  try {
    const result = spawnSync(process.execPath, [cli, '--repo', dir, '--no-start'], { env: { ...env, FIXTURE_STALE: 'yes' }, encoding: 'utf8' })
    assert.equal(result.status, 1)
    assert.ok(result.stderr.includes('SCHEMA_CAPABILITIES'))
    assert.equal(fs.readdirSync(dir).filter(n => n.startsWith('.env.local.backup-')).length, 1)
    assert.equal((result.stdout + result.stderr).includes('npg_FIXTURE'), false)
  } finally { fs.rmSync(dir, { recursive: true, force: true }); fs.rmSync(bin, { recursive: true, force: true }) }
})
