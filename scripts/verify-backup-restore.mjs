import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'
import {randomBytes} from 'node:crypto'
import pg from 'pg'
import {backupDatabase,verifyRestore} from './backup-database.mjs'
assert.equal(process.env.CI,'true','Restore rehearsal is CI-only')
const url=new URL(process.env.DATABASE_URL_UNPOOLED)
assert.ok(['localhost','127.0.0.1','[::1]'].includes(url.hostname),'Disposable local database only')
const directory=fs.mkdtempSync(path.join(os.tmpdir(),'campuspay-backup-'))
const file=path.join(directory,'synthetic.cpbackup'), key=randomBytes(32).toString('base64')
const source=new pg.Client({connectionString:url.href})
await source.connect()
const sourceState=async()=> (await source.query("select (select oid from pg_namespace where nspname='public') as public_oid,(select count(*) from private.schema_migrations)::text as migrations,(select count(*) from private.students)::text as students,(select count(*) from private.wallet_ledger)::text as ledger_rows")).rows[0]
const before=await sourceState()
const temporaryDatabases=async()=> (await source.query("select datname from pg_database where datname ~ '^cp_restore_[a-f0-9]{20}$' order by datname")).rows
const beforeTemporary=await temporaryDatabases()
try {
 const backup=await backupDatabase(url.href,key,file,url.hostname)
 assert.ok(backup.tables>20)
 assert.equal(fs.statSync(file).mode&0o777,0o600)
 const restored=await verifyRestore(url.href,key,file)
 assert.equal(restored.tables,backup.tables)
 assert.equal(restored.public_schema_recreated,true,'This archive explicitly recreates public; the default must not conflict')
 assert.deepEqual(await sourceState(),before,'Restore must not change the original database or its public schema')
 assert.deepEqual(await temporaryDatabases(),beforeTemporary,'Only the created verification database is cleaned up')
 await assert.rejects(()=>backupDatabase(url.href,key,file,url.hostname),{code:'EEXIST'})
 await assert.rejects(()=>verifyRestore(url.href,randomBytes(32).toString('base64'),file),/AUTHENTICATION/)
 await assert.rejects(()=>verifyRestore('postgresql://invalid:invalid@remote.invalid/campuspay',key,file),/LOCALHOST/)
 for(const suffix of ['?host=remote.invalid','?dbname=other','?service=external','?options=-csearch_path=public'])
  await assert.rejects(()=>verifyRestore(url.href.split('?')[0]+suffix,key,file),/CONNECTION_OPTIONS/)
 assert.deepEqual(await sourceState(),before)
 assert.deepEqual(await temporaryDatabases(),beforeTemporary)
 fs.mkdirSync('.validation/recovery',{recursive:true})
 fs.writeFileSync('.validation/recovery/restore-results.json',JSON.stringify({passed:true,fixture:'disposable-local-postgres',...restored,keyPersisted:false,productionRestoreCertified:false,sourceUnchanged:true,temporaryDatabaseCleaned:true},null,2))
 console.log('PASS: encrypted PostgreSQL dump restored with exact table digests and restricted runtime ACLs; no production data accessed')
} finally {await source.end();fs.rmSync(directory,{recursive:true,force:true})}
