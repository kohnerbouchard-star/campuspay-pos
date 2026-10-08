#!/usr/bin/env node
// Read-only production identity, history, and runtime-grant proof. No secrets printed.
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const manifest = JSON.parse(fs.readFileSync(new URL('./manifest.json', import.meta.url)))
const [phase, source] = process.argv.slice(2)
const fail = code => { throw new Error(code) }
let client
try {
  if (!['before', 'after'].includes(phase) || !source || process.argv.length !== 4) fail('USAGE')
  const raw = process.env.DATABASE_URL_UNPOOLED
  if (!raw) fail('OWNER_URL_MISSING')
  const url = new URL(raw)
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || url.hostname !== manifest.baseline.host
    || url.pathname !== '/' + manifest.baseline.database || decodeURIComponent(url.username) !== manifest.baseline.owner
    || url.searchParams.get('sslmode') !== 'verify-full' || url.hash
    || [...url.searchParams.keys()].some(key => key !== 'sslmode')) fail('OWNER_TARGET_INVALID')
  const require = createRequire(path.join(path.resolve(source), 'package.json'))
  const { Client } = require('pg')
  client = new Client({ connectionString: raw, connectionTimeoutMillis: 15000 })
  await client.connect()
  await client.query('begin read only')
  await client.query("set local statement_timeout='15s'")
  const identity = (await client.query('select current_user as role,current_database() as database')).rows[0]
  if (identity.role !== manifest.baseline.owner || identity.database !== manifest.baseline.database) fail('DATABASE_IDENTITY_MISMATCH')
  const versions = (await client.query('select version from private.schema_migrations order by version')).rows.map(row => row.version)
  const expected = Object.keys(manifest.files).filter(name => name.startsWith('database/migrations/'))
    .map(name => path.basename(name, '.sql')).sort()
  const want = phase === 'before' ? expected.slice(0, manifest.baseline.applied) : expected
  if (JSON.stringify(versions) !== JSON.stringify(want)) fail('MIGRATION_HISTORY_MISMATCH')
  const role = (await client.query("select rolcanlogin,rolsuper,rolcreatedb,rolcreaterole from pg_roles where rolname='campuspay_runtime'")).rows[0]
  if (!role || Object.values(role).some(Boolean)) fail('RUNTIME_ROLE_UNSAFE')
  const direct = await client.query("select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='private' and c.relkind in ('r','p') and has_table_privilege('campuspay_runtime',c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') limit 1")
  if (direct.rowCount) fail('RUNTIME_PRIVATE_TABLE_ACCESS')
  if (phase === 'after') {
    const signatures = [
      'api.create_staff_session(text,text,text,text,text)',
      'api.refund_cash_readiness(uuid,uuid,uuid)',
      'api.product_photo_command(uuid,uuid,uuid,text,jsonb)',
      'api.product_photo_catalog(uuid,uuid,uuid[])',
      'api.product_photo_cleanup(uuid,text,text,uuid,uuid)',
    ]
    for (const signature of signatures) {
      const result = (await client.query("select coalesce(has_function_privilege('campuspay_runtime',to_regprocedure($1),'EXECUTE'),false) as allowed", [signature])).rows[0]
      if (!result.allowed) fail('NEW_API_GRANT_MISSING')
    }
    const old = (await client.query("select coalesce(has_function_privilege('campuspay_runtime',to_regprocedure('api.create_staff_session(text,text,text,text)'),'EXECUTE'),false) as allowed")).rows[0]
    if (old.allowed) fail('OLD_LOGIN_STILL_EXECUTABLE')
  }
  await client.query('rollback')
  console.log(JSON.stringify({ status: phase === 'before' ? 'SCHEMA_38_READY' : 'SCHEMA_40_GRANTS_VERIFIED',
    historyRows: versions.length, lastVersion: versions.at(-1), targetHost: url.hostname,
    database: identity.database, owner: identity.role, runtimePrivateTableAccess: false }))
} catch (error) {
  console.error('STOP: ' + (/^[A-Z_]+$/.test(error?.message ?? '') ? error.message : 'DATABASE_PROBE_FAILED'))
  process.exitCode = 1
} finally { if (client) await client.end().catch(() => {}) }
