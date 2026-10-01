import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'
import {randomBytes} from 'node:crypto'
import {backupDatabase,verifyRestore} from './backup-database.mjs'
assert.equal(process.env.CI,'true','Restore rehearsal is CI-only')
const url=new URL(process.env.DATABASE_URL_UNPOOLED)
assert.ok(['localhost','127.0.0.1','[::1]'].includes(url.hostname),'Disposable local database only')
const directory=fs.mkdtempSync(path.join(os.tmpdir(),'campuspay-backup-'))
const file=path.join(directory,'synthetic.cpbackup'), key=randomBytes(32).toString('base64')
try {
 const backup=await backupDatabase(url.href,key,file,url.hostname)
 assert.ok(backup.tables>20)
 assert.equal(fs.statSync(file).mode&0o777,0o600)
 const restored=await verifyRestore(url.href,key,file)
 assert.equal(restored.tables,backup.tables)
 await assert.rejects(()=>verifyRestore(url.href,randomBytes(32).toString('base64'),file),/AUTHENTICATION/)
 await assert.rejects(()=>verifyRestore('postgresql://invalid:invalid@remote.invalid/campuspay',key,file),/LOCALHOST/)
 fs.mkdirSync('.validation/recovery',{recursive:true})
 fs.writeFileSync('.validation/recovery/restore-results.json',JSON.stringify({passed:true,fixture:'disposable-local-postgres',...restored,keyPersisted:false,productionRestoreCertified:false},null,2))
 console.log('PASS: encrypted PostgreSQL dump restored with exact table digests and restricted runtime ACLs; no production data accessed')
} finally {fs.rmSync(directory,{recursive:true,force:true})}
