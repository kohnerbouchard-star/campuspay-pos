import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'
const MAGIC=Buffer.from('CPBKP01\n')
function keyBytes(key) {
  if(typeof key!=='string'||!/^[A-Za-z0-9+/]{43}=$/.test(key)) throw new Error('INVALID_BACKUP_KEY')
  const bytes=Buffer.from(key,'base64')
  if(bytes.length!==32||bytes.toString('base64')!==key) throw new Error('INVALID_BACKUP_KEY')
  return bytes
}
export function sealBackup(dump, metadata, key) {
  const nonce=randomBytes(12), cipher=createCipheriv('aes-256-gcm',keyBytes(key),nonce)
  cipher.setAAD(MAGIC)
  const header=JSON.stringify({...metadata,format:1,dump_sha256:createHash('sha256').update(dump).digest('hex')})
  const ciphertext=Buffer.concat([cipher.update(Buffer.from(header+'\n')),cipher.update(dump),cipher.final()])
  return Buffer.concat([MAGIC,nonce,cipher.getAuthTag(),ciphertext])
}
export function openBackup(envelope,key) {
  try {
    if(envelope.length<37||!envelope.subarray(0,8).equals(MAGIC)) throw new Error('INVALID_BACKUP')
    const decipher=createDecipheriv('aes-256-gcm',keyBytes(key),envelope.subarray(8,20))
    decipher.setAAD(MAGIC);decipher.setAuthTag(envelope.subarray(20,36))
    const plain=Buffer.concat([decipher.update(envelope.subarray(36)),decipher.final()]), boundary=plain.indexOf(10)
    if(boundary<0) throw new Error('INVALID_BACKUP')
    const metadata=JSON.parse(plain.subarray(0,boundary).toString('utf8')), dump=plain.subarray(boundary+1)
    if(metadata.format!==1||metadata.dump_sha256!==createHash('sha256').update(dump).digest('hex')) throw new Error('INVALID_BACKUP')
    return {metadata,dump}
  } catch { throw new Error('BACKUP_AUTHENTICATION_FAILED') }
}
