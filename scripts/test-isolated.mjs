// Creates only its own disposable localhost database. Never accepts a remote URL.
import pg from 'pg'
import { randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
const url = new URL(process.env.TEST_POSTGRES_URL ?? 'postgresql://postgres:refresh-local-only@127.0.0.1:55439/postgres')
if (!['localhost', '127.0.0.1'].includes(url.hostname)) throw new Error('Only isolated localhost PostgreSQL is supported')
const admin = new pg.Client({ connectionString: url.toString() })
await admin.connect()
const name = `campuspay_refresh_${randomUUID().replaceAll('-', '')}`
await admin.query(`create database ${name}`)
url.pathname = `/${name}`
const env = { ...process.env, DATABASE_URL_UNPOOLED: url.toString(), CI_BROWSER: process.env.CI_BROWSER ?? '0' }
const run = (script, args = []) => new Promise((resolve, reject) => {
  const child = spawn(process.execPath, [script, ...args], { env, stdio: 'inherit' })
  child.on('error', reject); child.on('exit', code => code === 0 ? resolve() : reject(new Error(`${script} exited with ${code}`)))
})
try { await run('scripts/migrate.mjs'); await run('scripts/migrate.mjs', ['--preflight', '--check-runtime']); await run('scripts/integration-test.mjs') }
finally { await admin.query(`drop database ${name} with (force)`); await admin.end() }
