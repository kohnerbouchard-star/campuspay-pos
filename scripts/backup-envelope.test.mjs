import test from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { sealBackup,openBackup } from './lib/backup-envelope.mjs'
test('encrypted backup authenticates metadata and complete binary dump',()=>{
 const key=randomBytes(32).toString('base64'),dump=randomBytes(2048),meta={schema:'synthetic-only'}
 const file=sealBackup(dump,meta,key), result=openBackup(file,key)
 assert.deepEqual(result.dump,dump);assert.equal(result.metadata.schema,meta.schema)
 assert.equal(file.includes(Buffer.from('synthetic-only')),false)
 assert.notDeepEqual(sealBackup(dump,meta,key),file)
 assert.throws(()=>openBackup(file,randomBytes(32).toString('base64')),/AUTHENTICATION/)
 for(const offset of [0,8,20,36,file.length-1]){const altered=Buffer.from(file);altered[offset]^=1;assert.throws(()=>openBackup(altered,key),/AUTHENTICATION/)}
 for(const length of [0,8,35,file.length-1])assert.throws(()=>openBackup(file.subarray(0,length),key),/AUTHENTICATION/)
 for(const bad of ['', 'bad',randomBytes(31).toString('base64')]) assert.throws(()=>sealBackup(dump,meta,bad),/INVALID_BACKUP_KEY/)
})
