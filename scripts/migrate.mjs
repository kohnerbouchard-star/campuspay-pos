#!/usr/bin/env node
import fs from 'node:fs'
import { createHash } from 'node:crypto'
import path from 'node:path'
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
const files = fs.readdirSync('database/migrations').filter(file => file.endsWith('.sql')).sort()
const versions = files.map(file => file.slice(0, -4))
console.log(JSON.stringify({ mode: preflight ? 'preflight' : 'migrate', target_host: target.hostname, database: target.pathname.slice(1) }))
const client = new pg.Client({ connectionString: url })
let applying = null
try {
  await client.connect()
  await client.query('select pg_advisory_lock(84632291)')
  const owner = (await client.query("select has_database_privilege(current_user,current_database(),'CREATE') or case when to_regnamespace('private') is not null then has_schema_privilege(current_user,'private','CREATE') else false end as owner_access")).rows[0]
  if (!owner.owner_access) throw new Error('OWNER_CONNECTION_REQUIRED')
  const exists = (await client.query("select to_regclass('private.schema_migrations') as relation")).rows[0].relation
  const applied = exists ? (await client.query('select version from private.schema_migrations order by version')).rows.map(row => row.version) : []
  if (applied.some(version => !versions.includes(version))) throw new Error('UNEXPECTED_SCHEMA_VERSION')
  const last = Math.max(-1, ...applied.map(version => versions.indexOf(version)))
  if (versions.slice(0, last + 1).some(version => !applied.includes(version))) throw new Error('MIGRATION_GAP')
  const pending = versions.filter(version => !applied.includes(version))
  console.log(JSON.stringify({ current_schema_version: applied.at(-1) ?? null, pending_migrations: pending }))
  const checksumColumn = exists && (await client.query("select 1 from information_schema.columns where table_schema='private' and table_name='schema_migrations' and column_name='checksum_sha256'")).rowCount > 0
  if (checksumColumn) {
    const recorded = (await client.query('select version,checksum_sha256 from private.schema_migrations')).rows
    for (const row of recorded) {
      if (!row.checksum_sha256) continue // Historical application cannot be certified from today's file.
      const hash = createHash('sha256').update(fs.readFileSync(path.join('database/migrations', `${row.version}.sql`))).digest('hex')
      if (hash !== row.checksum_sha256) throw new Error('APPLIED_MIGRATION_CHANGED')
    }
    console.log(JSON.stringify({ unverified_historical_migrations: recorded.filter(row => !row.checksum_sha256).map(row => row.version) }))
  } else if (applied.length) console.log(JSON.stringify({ unverified_historical_migrations: applied }))
  if (requireRuntime) {
    const role = (await client.query("select rolcanlogin,rolsuper,rolcreatedb,rolcreaterole from pg_roles where rolname='campuspay_runtime'")).rows[0]
    if (!role || Object.values(role).some(Boolean)) throw new Error('INVALID_RUNTIME_ROLE')
    const access = await client.query("select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='private' and c.relkind in ('r','p') and has_table_privilege('campuspay_runtime',c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') limit 1")
    if (access.rowCount) throw new Error('RUNTIME_HAS_PRIVATE_TABLE_ACCESS')
    const api = (await client.query("select has_schema_privilege('campuspay_runtime','api','USAGE') as usage,has_function_privilege('campuspay_runtime','api.authorize_session(text,text,text)','EXECUTE') as execute")).rows[0]
    if (!api.usage || !api.execute) throw new Error('RUNTIME_API_GRANT_MISSING')
    console.log('Runtime role preflight passed.')
  }
  if (!preflight) {
    await client.query('create schema if not exists private')
    await client.query('create table if not exists private.schema_migrations(version text primary key, applied_at timestamptz not null default now())')
    await client.query("alter table private.schema_migrations add column if not exists checksum_sha256 text check(checksum_sha256 is null or checksum_sha256 ~ '^[a-f0-9]{64}$')")
    for (const version of pending) {
      applying = version
      await client.query('begin')
      try {
        await client.query(fs.readFileSync(path.join('database/migrations', `${version}.sql`), 'utf8'))
        const checksum = createHash('sha256').update(fs.readFileSync(path.join('database/migrations', `${version}.sql`))).digest('hex')
        await client.query('insert into private.schema_migrations(version,checksum_sha256) values($1,$2) on conflict (version) do update set checksum_sha256=excluded.checksum_sha256', [version, checksum])
        await client.query('commit')
        console.log(`Applied ${version}`)
      } catch (error) { await client.query('rollback'); throw error }
    }
  }
} catch (error) {
  // PG error text can contain connection credentials or statements. Allow codes only.
  const known = ['APPLIED_MIGRATION_CHANGED','OWNER_CONNECTION_REQUIRED','UNEXPECTED_SCHEMA_VERSION','MIGRATION_GAP','INVALID_RUNTIME_ROLE','RUNTIME_HAS_PRIVATE_TABLE_ACCESS','RUNTIME_API_GRANT_MISSING']
  const code = known.includes(error?.message) ? error.message : /^[0-9A-Z]{5}$/.test(error?.code ?? '') ? error.code : 'MIGRATION_CONNECTION_OR_EXECUTION_FAILED'
  console.error(JSON.stringify({ event: 'migration_failed', migration: applying, code }))
  process.exitCode = 1
} finally { await client.end() }
