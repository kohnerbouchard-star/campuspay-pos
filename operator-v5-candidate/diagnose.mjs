#!/usr/bin/env node
// Read-only history inspection after any uncertain or partial migration result.
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'

const manifest = JSON.parse(fs.readFileSync(new URL('./manifest.json', import.meta.url)))
const [source, attemptState] = process.argv.slice(2)
const fail = code => { throw new Error(code) }
let client
try {
  if (!source || !['attempt-recorded', 'no-attempt-recorded'].includes(attemptState)
    || process.argv.length !== 4) fail('USAGE')
  const raw = process.env.DATABASE_URL_UNPOOLED
  if (!raw) fail('OWNER_URL_MISSING')
  const url = new URL(raw)
  if (!['postgres:', 'postgresql:'].includes(url.protocol)
    || url.hostname !== manifest.baseline.host
    || url.pathname !== '/' + manifest.baseline.database
    || decodeURIComponent(url.username) !== manifest.baseline.owner
    || url.searchParams.get('sslmode') !== 'verify-full' || url.hash
    || [...url.searchParams.keys()].some(key => key !== 'sslmode')) fail('OWNER_TARGET_INVALID')
  const require = createRequire(path.join(path.resolve(source), 'package.json'))
  const { Client } = require('pg')
  client = new Client({ connectionString: raw, connectionTimeoutMillis: 15000 })
  await client.connect()
  await client.query('begin read only')
  await client.query("set local statement_timeout='15s'")
  const identity = (await client.query('select current_user as role,current_database() as database')).rows[0]
  if (identity.role !== manifest.baseline.owner || identity.database !== manifest.baseline.database)
    fail('DATABASE_IDENTITY_MISMATCH')
  const actual = (await client.query('select version from private.schema_migrations order by version')).rows.map(row => row.version)
  const expected = Object.keys(manifest.files).filter(name => name.startsWith('database/migrations/'))
    .map(name => path.basename(name, '.sql')).sort()
  if (actual.length < manifest.baseline.applied || actual.length > expected.length
    || JSON.stringify(actual) !== JSON.stringify(expected.slice(0, actual.length)))
    fail('MIGRATION_HISTORY_UNEXPECTED')
  const privateAccess = await client.query("select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='private' and c.relkind in ('r','p') and has_table_privilege('campuspay_runtime',c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') limit 1")
  if (privateAccess.rowCount) fail('RUNTIME_PRIVATE_TABLE_ACCESS')
  await client.query('rollback')
  const status = actual.length === 38 ? 'SCHEMA_38_REVIEW_ATTEMPT_STATE'
    : actual.length === 39 ? 'SCHEMA_39_PARTIAL_STOP_FIX_FORWARD_REVIEW_REQUIRED'
      : 'SCHEMA_40_POSTFLIGHT_REVIEW_REQUIRED'
  console.log(JSON.stringify({ status, historyRows: actual.length, lastVersion: actual.at(-1),
    pending: expected.slice(actual.length), attemptRecorded: attemptState === 'attempt-recorded',
    targetHost: url.hostname, database: identity.database, owner: identity.role,
    runtimePrivateTableAccess: false }))
} catch (error) {
  console.error('STOP: ' + (/^[A-Z_]+$/.test(error?.message ?? '') ? error.message : 'DIAGNOSTIC_PROBE_FAILED'))
  process.exitCode = 1
} finally { if (client) await client.end().catch(() => {}) }
