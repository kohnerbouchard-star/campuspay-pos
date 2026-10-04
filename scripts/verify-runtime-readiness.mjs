#!/usr/bin/env node
// CI-only ACL smoke test against the disposable local PostgreSQL service.
import assert from 'node:assert/strict'
import pg from 'pg'
import { REQUIRED_APIS, checkRuntime } from './lib/local-readiness.mjs'

const raw = process.env.DATABASE_URL_UNPOOLED
let client
try {
  const target = new URL(raw)
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(target.hostname), 'Local disposable PostgreSQL is required')
  assert.equal(process.env.CI, 'true', 'This smoke test is CI-only')
  client = new pg.Client({ connectionString: raw, connectionTimeoutMillis: 15_000, query_timeout: 10_000 })
  await client.connect()
  await client.query('SET ROLE campuspay_runtime')
  const result = await checkRuntime(client, { DATABASE_URL: raw })
  assert.equal(result.capabilities, REQUIRED_APIS.length)
  await client.query('RESET ROLE')
  await assert.rejects(() => checkRuntime(client, { DATABASE_URL: raw }), error => error.safeCode === 'RUNTIME_PRIVILEGES')
  console.log('Disposable PostgreSQL: restricted runtime passes; privileged owner is rejected.')
} catch {
  console.error('Disposable runtime-readiness test failed. No connection values were printed.')
  process.exitCode = 1
} finally {
  if (client) {
    try { await client.end() } catch { process.exitCode = 1 }
  }
}
