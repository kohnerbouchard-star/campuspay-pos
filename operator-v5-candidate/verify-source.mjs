#!/usr/bin/env node
// Offline, byte-exact qualification of the source checkout used by the operator.
import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'

const manifest = JSON.parse(fs.readFileSync(new URL('./manifest.json', import.meta.url)))
const source = process.argv[2] && path.resolve(process.argv[2])
const filesOnly = process.argv[3] === '--files-only'
const fail = code => { throw new Error(code) }
const git = (...args) => execFileSync('git', ['-C', source, ...args], { encoding: 'utf8' }).trim()
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
try {
  if (!source || process.argv.length !== (filesOnly ? 4 : 3)) fail('USAGE_SOURCE_DIRECTORY_REQUIRED')
  if (!filesOnly) {
    if (git('rev-parse', 'HEAD') !== manifest.head || git('rev-parse', 'HEAD^{tree}') !== manifest.tree)
      fail('SOURCE_COMMIT_OR_TREE_MISMATCH')
    if (git('status', '--porcelain')) fail('SOURCE_CHECKOUT_NOT_CLEAN')
  }
  const migrationDir = path.join(source, 'database', 'migrations')
  const actualMigrations = fs.readdirSync(migrationDir).filter(x => x.endsWith('.sql')).sort()
  const expectedMigrations = Object.keys(manifest.files).filter(x => x.startsWith('database/migrations/')).map(x => path.basename(x)).sort()
  if (JSON.stringify(actualMigrations) !== JSON.stringify(expectedMigrations)) fail('MIGRATION_SET_MISMATCH')
  for (const [name, expected] of Object.entries(manifest.files)) {
    const file = path.join(source, name)
    const stat = fs.lstatSync(file)
    if (!stat.isFile() || stat.isSymbolicLink() || hash(fs.readFileSync(file)) !== expected)
      fail('SOURCE_FILE_BYTES_MISMATCH')
  }
  console.log(JSON.stringify({ status: 'EXACT_SOURCE_VERIFIED', head: manifest.head, tree: manifest.tree,
    migrationFiles: expectedMigrations.length, pending: manifest.pending }))
} catch (error) {
  console.error('STOP: ' + (/^[A-Z_]+$/.test(error?.message ?? '') ? error.message : 'SOURCE_VERIFICATION_FAILED'))
  process.exitCode = 1
}
