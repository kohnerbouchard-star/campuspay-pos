// Operator-only tool. Never imported by the application. No credentials in argv/logs.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import pg from 'pg'
import { sealBackup, openBackup } from './lib/backup-envelope.mjs'
const MAX_BYTES=64*1024*1024
const quoted=value=>'"'+value.replaceAll('"','""')+'"'
function databaseUrl(value) {
  const url=new URL(value)
  if(!['postgres:','postgresql:'].includes(url.protocol)||!url.hostname||!url.pathname.slice(1)) throw new Error('BACKUP_CONFIGURATION_INVALID')
  return url
}
function pgTool(binary,args,url,input) {
  const env={...process.env,PGHOST:url.hostname,PGPORT:url.port||'5432',PGUSER:decodeURIComponent(url.username),PGPASSWORD:decodeURIComponent(url.password),PGDATABASE:decodeURIComponent(url.pathname.slice(1)),PGSSLMODE:url.searchParams.get('sslmode')||'prefer',PGCONNECT_TIMEOUT:'15'}
  const result=spawnSync(binary,args,{env,input,maxBuffer:MAX_BYTES,timeout:120000,stdio:['pipe','pipe','pipe']})
  if(result.error||result.status!==0) throw new Error('POSTGRES_BACKUP_TOOL_FAILED')
  return result.stdout
}
async function inventory(client) {
  const tables=(await client.query("select schemaname,tablename from pg_tables where schemaname in ('public','private') order by schemaname,tablename")).rows
  const rows=[]
  for(const table of tables) {
    const name=quoted(table.schemaname)+'.'+quoted(table.tablename)
    const result=await client.query(`select count(*)::text as count, md5(coalesce(string_agg(to_jsonb(t)::text,E'\\n' order by to_jsonb(t)::text),'')) as digest from ${name} t`)
    rows.push({...table,...result.rows[0]})
  }
  return rows
}
export async function backupDatabase(source,key,output,expectedHost) {
  const url=databaseUrl(source)
  if(!expectedHost||url.hostname!==expectedHost) throw new Error('BACKUP_TARGET_MISMATCH')
  if(!['localhost','127.0.0.1','[::1]'].includes(url.hostname)&&url.searchParams.get('sslmode')!=='verify-full') throw new Error('BACKUP_REQUIRES_VERIFIED_TLS')
  if(!output.endsWith('.cpbackup')) throw new Error('BACKUP_PATH_INVALID')
  // Validate key before opening the database or invoking pg_dump.
  sealBackup(Buffer.alloc(0),{},key)
  const client=new pg.Client({connectionString:source,connectionTimeoutMillis:15000})
  try {
    await client.connect();await client.query("begin isolation level repeatable read read only")
    await client.query("set local timezone='UTC'");await client.query("set local statement_timeout='30s'")
    const snapshot=(await client.query('select pg_export_snapshot() as id')).rows[0].id
    const tables=await inventory(client)
    const roles=(await client.query("select rolname from pg_roles where rolname not like 'pg_%' order by rolname")).rows.map(r=>r.rolname)
    const dump=pgTool(process.env.PG_DUMP_BIN||'pg_dump',['--format=custom','--no-password','--schema=public','--schema=private','--schema=api','--schema=extensions','--extension=pgcrypto',`--snapshot=${snapshot}`],url)
    const bytes=sealBackup(dump,{captured_at:new Date().toISOString(),database:decodeURIComponent(url.pathname.slice(1)),tables,roles},key)
    fs.writeFileSync(output,bytes,{flag:'wx',mode:0o600})
    await client.query('commit')
    return {tables:tables.length,bytes:bytes.length}
  } finally {await client.end()}
}
export async function verifyRestore(controlUrl,key,backupPath) {
  const target=databaseUrl(controlUrl)
  if(!['localhost','127.0.0.1','[::1]'].includes(target.hostname)) throw new Error('RESTORE_REQUIRES_DISPOSABLE_LOCALHOST')
  if(fs.statSync(backupPath).size>MAX_BYTES) throw new Error('BACKUP_TOO_LARGE')
  const {metadata,dump}=openBackup(fs.readFileSync(backupPath),key)
  if(!Array.isArray(metadata.tables)||!Array.isArray(metadata.roles)) throw new Error('BACKUP_METADATA_INVALID')
  const control=new pg.Client({connectionString:controlUrl,connectionTimeoutMillis:15000})
  const name='cp_restore_'+randomBytes(10).toString('hex'),createdRoles=[]
  let created=false,restored
  try {
    await control.connect()
    for(const role of metadata.roles) {
      if(typeof role!=='string'||role.length>63) throw new Error('BACKUP_ROLE_INVALID')
      if(!(await control.query('select 1 from pg_roles where rolname=$1',[role])).rowCount) {
        await control.query(`create role ${quoted(role)} nologin noinherit`);createdRoles.push(role)
      }
    }
    await control.query(`create database ${quoted(name)} template template0`);created=true
    target.pathname='/'+name
    // Keep recorded ACLs. Ownership is mapped only for this isolated verification DB.
    pgTool(process.env.PG_RESTORE_BIN||'pg_restore',['--no-owner','--no-password','--exit-on-error','--dbname='+name],target,dump)
    restored=new pg.Client({connectionString:target.href,connectionTimeoutMillis:15000});await restored.connect()
    await restored.query("set timezone='UTC'");await restored.query("set statement_timeout='30s'")
    const actual=await inventory(restored)
    if(JSON.stringify(actual)!==JSON.stringify(metadata.tables)) throw new Error('RESTORE_INTEGRITY_MISMATCH')
    const grants=(await restored.query("select count(*)::integer n from information_schema.table_privileges where grantee='campuspay_runtime' and table_schema in ('private','public')")).rows[0].n
    if(grants!==0) throw new Error('RESTORE_RUNTIME_GRANTS_UNSAFE')
    return {tables:actual.length,integrity:'matched',runtime_direct_table_grants:grants}
  } finally {
    if(restored)await restored.end()
    if(created)await control.query(`drop database ${quoted(name)} with (force)`)
    for(const role of createdRoles.reverse())await control.query(`drop role ${quoted(role)}`)
    await control.end()
  }
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try {
    const mode=process.argv[2],file=process.argv[3],key=process.env.CAMPUSPAY_BACKUP_KEY
    if(mode==='backup') console.log(JSON.stringify(await backupDatabase(process.env.BACKUP_DATABASE_URL,key,file,process.env.BACKUP_EXPECTED_HOST)))
    else if(mode==='verify-restore') console.log(JSON.stringify(await verifyRestore(process.env.RESTORE_TEST_DATABASE_URL,key,file)))
    else throw new Error('BACKUP_USAGE_INVALID')
  } catch {console.error('Backup/restore verification failed. No credentials or database contents were printed.');process.exitCode=1}
}
