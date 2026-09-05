#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import pg from 'pg'
const url = process.env.DATABASE_URL_UNPOOLED
if (!url) throw new Error('Set DATABASE_URL_UNPOOLED to the database owner direct connection for migrations only.')
if (new URL(url).hostname.includes('-pooler')) throw new Error('Migrations require a direct connection, not a pooler.')
const client = new pg.Client({connectionString:url})
await client.connect()
try {
  await client.query('select pg_advisory_lock(84632291)')
  await client.query('create schema if not exists private')
  await client.query('create table if not exists private.schema_migrations(version text primary key, applied_at timestamptz not null default now())')
  for (const file of fs.readdirSync('database/migrations').filter(f=>f.endsWith('.sql')).sort()) {
    const version=file.slice(0,-4)
    if ((await client.query('select 1 from private.schema_migrations where version=$1',[version])).rowCount) continue
    await client.query('begin')
    try {
      await client.query(fs.readFileSync(path.join('database/migrations',file),'utf8'))
      await client.query('insert into private.schema_migrations(version) values($1) on conflict do nothing',[version])
      await client.query('commit')
      console.log(`Applied ${version}`)
    } catch(e) { await client.query('rollback'); throw e }
  }
} finally { await client.end() }
