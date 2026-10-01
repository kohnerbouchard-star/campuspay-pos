// Temporary maintenance helper: consumes npm's proposal; never updates a Git ref.
import fs from 'node:fs'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
const keys=['node_modules/brace-expansion','node_modules/@typescript-eslint/typescript-estree/node_modules/brace-expansion']
const versions=['1.1.21','5.0.12']
if(process.argv[2]!=='publish') {
  const original=JSON.parse(execFileSync('git',['show','HEAD:package-lock.json'],{encoding:'utf8'}))
  const proposal=JSON.parse(fs.readFileSync('package-lock.json','utf8'))
  for(const [i,key] of keys.entries()) {
    const entry=proposal.packages[key]
    assert.equal(entry.version,versions[i])
    assert.equal(entry.resolved,`https://registry.npmjs.org/brace-expansion/-/brace-expansion-${versions[i]}.tgz`)
    assert.deepEqual(entry.dependencies,original.packages[key].dependencies)
    original.packages[key]=entry
  }
  // Keep all unrelated optional-platform/libc metadata and direct dependencies.
  fs.writeFileSync('package-lock.json',JSON.stringify(original,null,2)+'\n')
} else {
  assert.equal(process.env.GITHUB_REPOSITORY,'kohnerbouchard-star/campuspay-pos')
  const data=fs.readFileSync('.lock-proposal/package-lock.json')
  const expected=createHash('sha1').update(`blob ${data.length}\0`).update(data).digest('hex')
  assert.equal(expected,'e4925ca2f7dac4544ef462c15657bd13caa810d4')
  const response=await fetch(`https://api.github.com/repos/kohnerbouchard-star/campuspay-pos/git/blobs`,{
    method:'POST',headers:{Accept:'application/vnd.github+json',Authorization:`Bearer ${process.env.PROPOSAL_GITHUB_TOKEN}`,'Content-Type':'application/json','X-GitHub-Api-Version':'2022-11-28'},
    body:JSON.stringify({content:data.toString('base64'),encoding:'base64'})
  })
  assert.ok(response.ok,`Proposal blob store failed with HTTP ${response.status}`)
  const result=await response.json();assert.equal(result.sha,expected)
  fs.writeFileSync('.lock-proposal/git-blob-sha.txt',result.sha+'\n')
  console.log('Stored reviewed npm lockfile blob; no branch, commit or pull request changed.')
}
