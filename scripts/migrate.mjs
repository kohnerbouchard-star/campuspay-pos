#!/usr/bin/env node
import { runMigrations } from './lib/migration-runner.mjs'
import pg from 'pg'

const url = process.env.DATABASE_URL_UNPOOLED
if (!url) throw new Error('Set DATABASE_URL_UNPOOLED to the database owner direct connection for migrations only.')
let target
try { target = new URL(url) }
catch { throw new Error('DATABASE_URL_UNPOOLED must be a valid direct owner connection URL.') }
if (target.hostname.includes('-pooler')) throw new Error('Migrations require a direct connection, not a pooler.')
if (process.env.EXPECTED_DATABASE_HOST && target.hostname !== process.env.EXPECTED_DATABASE_HOST) throw new Error('Migration target does not match EXPECTED_DATABASE_HOST.')
const preflight = process.argv.includes('--preflight')
const requireRuntime = process.argv.includes('--check-runtime')
console.log(JSON.stringify({ mode: preflight ? 'preflight' : 'migrate', target_host: target.hostname, database: target.pathname.slice(1) }))
const client = new pg.Client({ connectionString: url })
try {
  await client.connect()
  await runMigrations(client, { preflight, requireRuntime })
} catch (error) {
  // PG error text can contain connection credentials or statements. Allow codes only.
  const known = ['OWNER_CONNECTION_REQUIRED','UNEXPECTED_SCHEMA_VERSION','MIGRATION_GAP','INVALID_RUNTIME_ROLE','RUNTIME_HAS_PRIVATE_TABLE_ACCESS','RUNTIME_API_GRANT_MISSING']
  const code = known.includes(error?.message) ? error.message : /^[0-9A-Z]{5}$/.test(error?.code ?? '') ? error.code : 'MIGRATION_CONNECTION_OR_EXECUTION_FAILED'
  console.error(JSON.stringify({ event: 'migration_failed', migration: error.migration ?? null, code }))
  process.exitCode = 1
} finally { await client.end() }
