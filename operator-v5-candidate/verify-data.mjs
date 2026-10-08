#!/usr/bin/env node
// Compare every pre-existing public/private table with the authenticated backup snapshot.
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'

const [source, backupFile] = process.argv.slice(2)
const fail = code => { throw new Error(code) }
const quoted = value => '"' + value.replaceAll('"', '""') + '"'
let client
try {
  if (!source || !backupFile || process.argv.length !== 4) fail('USAGE')
  if (!process.env.DATABASE_URL_UNPOOLED || !process.env.CAMPUSPAY_BACKUP_KEY) fail('VERIFICATION_INPUT_MISSING')
  const { openBackup } = await import(pathToFileURL(path.join(path.resolve(source), 'scripts/lib/backup-envelope.mjs')).href)
  const { metadata } = openBackup(fs.readFileSync(backupFile), process.env.CAMPUSPAY_BACKUP_KEY)
  if (metadata.database !== 'campuspay' || !Array.isArray(metadata.tables) || metadata.tables.length < 10)
    fail('BACKUP_METADATA_MISMATCH')
  const require = createRequire(path.join(path.resolve(source), 'package.json'))
  const { Client } = require('pg')
  client = new Client({ connectionString: process.env.DATABASE_URL_UNPOOLED, connectionTimeoutMillis: 15000 })
  await client.connect()
  await client.query('begin read only')
  await client.query("set local statement_timeout='30s'")
  const identity = (await client.query('select current_user as role,current_database() as database')).rows[0]
  if (identity.role !== 'campuspay_owner' || identity.database !== metadata.database) fail('DATABASE_IDENTITY_MISMATCH')
  let compared = 0
  for (const table of metadata.tables) {
    if (table.schemaname === 'private' && table.tablename === 'schema_migrations') continue
    if (!['public', 'private'].includes(table.schemaname) || !/^[a-z_][a-z0-9_]*$/.test(table.tablename))
      fail('BACKUP_TABLE_INVALID')
    const name = quoted(table.schemaname) + '.' + quoted(table.tablename)
    const result = (await client.query(`select count(*)::text as count, md5(coalesce(string_agg(to_jsonb(t)::text,E'\\n' order by to_jsonb(t)::text collate "C"),'')) as digest from ${name} t`)).rows[0]
    if (result.count !== table.count || result.digest !== table.digest) fail('PRE_EXISTING_DATA_CHANGED')
    compared++
  }
  await client.query('rollback')
  console.log(JSON.stringify({ status: 'PRE_EXISTING_TABLES_UNCHANGED', compared, backupCapturedAt: metadata.captured_at }))
} catch (error) {
  console.error('STOP: ' + (/^[A-Z_]+$/.test(error?.message ?? '') ? error.message : 'DATA_VERIFICATION_FAILED'))
  process.exitCode = 1
} finally { if (client) await client.end().catch(() => {}) }
