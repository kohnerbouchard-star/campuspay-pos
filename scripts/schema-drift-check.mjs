import fs from 'node:fs'
import assert from 'node:assert/strict'

// 001–009 are the combined initial migration. 010–012 retain historical
// bootstrap/completion differences. From 013 onwards modules are exact pairs.
const modules = fs.readdirSync('database/schema').filter(name => /^\d{3}_.*\.sql$/.test(name) && Number(name.slice(0, 3)) >= 13).sort()
const migrations = fs.readdirSync('database/migrations').filter(name => name.endsWith('.sql'))
for (const schemaFile of modules) {
  const suffix = schemaFile.slice(3)
  const matches = migrations.filter(name => name.slice(14) === suffix)
  assert.equal(matches.length, 1, `Expected exactly one migration for ${schemaFile}`)
  assert.deepEqual(fs.readFileSync(`database/schema/${schemaFile}`), fs.readFileSync(`database/migrations/${matches[0]}`), `Schema drift: ${schemaFile} / ${matches[0]}`)
}
for (const migration of migrations.filter(name => name >= '20260907090000')) {
  assert.ok(modules.some(schemaFile => schemaFile.slice(3) === migration.slice(14)), `Missing canonical schema module: ${migration}`)
}
console.log(`Migration/schema drift check passed for ${modules.length} exact pairs (013 onwards).`)
