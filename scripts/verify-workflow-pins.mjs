import fs from 'node:fs'
import assert from 'node:assert/strict'
for (const file of fs.readdirSync('.github/workflows').filter(f => /\.ya?ml$/.test(f))) {
  const source = fs.readFileSync(`.github/workflows/${file}`, 'utf8')
  for (const match of source.matchAll(/\buses:\s*([^\s#]+)/g)) {
    assert.match(match[1], /^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_./-]+@[0-9a-f]{40}$/, `Unpinned action in ${file}`)
  }
}
console.log('PASS: workflow actions use full immutable commit identifiers')
