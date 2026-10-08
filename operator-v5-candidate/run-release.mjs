#!/usr/bin/env node
// Operator-only, fail-stop cutover driver. No production connection is bundled.
import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = path.dirname(fileURLToPath(import.meta.url))
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json')))
const [phase, sourceArg, evidenceArg] = process.argv.slice(2)
const fail = code => { throw new Error(code) }
const hash = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex')
const writeNew = (file, payload) => {
  const fd = fs.openSync(file, 'wx', 0o600)
  try { fs.writeFileSync(fd, JSON.stringify(payload, null, 2) + '\n'); fs.fsyncSync(fd) }
  finally { fs.closeSync(fd) }
}
function hidden(prompt) {
  if (!process.stdin.isTTY || !process.stdin.setRawMode) fail('INTERACTIVE_TERMINAL_REQUIRED')
  process.stdout.write(prompt + ': ')
  return new Promise((resolve, reject) => {
    const value = []
    process.stdin.setRawMode(true)
    process.stdin.resume()
    const finish = (error) => {
      process.stdin.off('data', input)
      process.stdin.setRawMode(false)
      process.stdin.pause()
      process.stdout.write('\n')
      error ? reject(error) : resolve(Buffer.from(value).toString('utf8'))
    }
    const input = bytes => {
      for (const byte of bytes) {
        if (byte === 3) return finish(new Error('OPERATOR_CANCELLED'))
        if (byte === 13 || byte === 10) return finish(null)
        if (byte === 8 || byte === 127) { value.pop(); continue }
        if (byte < 32 || value.length >= 2048) return finish(new Error('SECRET_INPUT_INVALID'))
        value.push(byte)
      }
    }
    process.stdin.on('data', input)
  })
}
function run(source, script, args, env, timeout = 120000) {
  const output = execFileSync(process.execPath, [script, ...args], {
    cwd: source, env, encoding: 'utf8', timeout, maxBuffer: 2 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  return output.trim()
}
function requiredPreflight(source, env) {
  const identity = run(source, path.join(root, 'probe.mjs'), ['before', source], env)
  const output = run(source, path.join(source, 'scripts/migrate.mjs'), ['--preflight', '--check-runtime'], env)
  const record = output.split(/\r?\n/).find(line => line.includes('"pending_migrations"'))
  if (!record || JSON.stringify(JSON.parse(record).pending_migrations) !== JSON.stringify(manifest.pending)) fail('MIGRATION_PENDING_SET_MISMATCH')
  console.log(identity)
  console.log(JSON.stringify({ status: 'EXACT_PENDING_VERIFIED', pending: manifest.pending }))
}

let attemptStarted = false
try {
  if (!['preflight', 'backup-and-restore', 'apply', 'postflight', 'diagnose'].includes(phase)
    || !sourceArg || !evidenceArg || process.argv.length !== 5) fail('USAGE')
  const source = fs.realpathSync(sourceArg)
  const evidence = fs.realpathSync(evidenceArg)
  if (!fs.statSync(evidence).isDirectory()) fail('EVIDENCE_DIRECTORY_REQUIRED')
  const inContainer = process.env.CAMPUSPAY_OPERATOR_HOST_GIT_VERIFIED === manifest.head
  console.log(run(source, path.join(root, 'verify-source.mjs'), inContainer ? [source, '--files-only'] : [source], process.env))
  const password = await hidden('Production campuspay_owner password (hidden)')
  if (!password) fail('OWNER_PASSWORD_MISSING')
  const url = new URL(`postgresql://${manifest.baseline.host}:5432/${manifest.baseline.database}?sslmode=verify-full`)
  url.username = manifest.baseline.owner
  url.password = password
  const ownerUrl = url.href
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
    !key.startsWith('PG') || key === 'PG_DUMP_BIN' || key === 'PG_RESTORE_BIN'))
  Object.assign(env, { DATABASE_URL_UNPOOLED: ownerUrl, EXPECTED_DATABASE_HOST: manifest.baseline.host,
    BACKUP_DATABASE_URL: ownerUrl, BACKUP_EXPECTED_HOST: manifest.baseline.host })
  const backupFile = path.join(evidence, 'campuspay-before-39-40.cpbackup')
  const proofFile = path.join(evidence, 'backup-restore-verified.json')
  const attemptFile = path.join(evidence, 'migration-attempt-started.json')
  const verifiedBackup = () => {
    if (!fs.existsSync(proofFile)) fail('BACKUP_RESTORE_PROOF_MISSING')
    const proof = JSON.parse(fs.readFileSync(proofFile, 'utf8'))
    if (proof.status !== 'BACKUP_AND_LOCAL_RESTORE_VERIFIED' || proof.source !== manifest.head
      || proof.tree !== manifest.tree || proof.historyRows !== 38 || proof.file !== backupFile
      || !fs.existsSync(backupFile) || proof.sha256 !== hash(backupFile)) fail('BACKUP_RESTORE_PROOF_MISMATCH')
  }
  if (phase === 'diagnose') {
    console.log(run(source, path.join(root, 'diagnose.mjs'), [source, fs.existsSync(attemptFile) ? 'attempt-recorded' : 'no-attempt-recorded'], env))
    process.exit(0)
  }
  if (phase === 'postflight') {
    verifiedBackup()
    env.CAMPUSPAY_BACKUP_KEY = await hidden('Existing backup encryption key (hidden)')
    console.log(run(source, path.join(root, 'probe.mjs'), ['after', source], env))
    console.log(run(source, path.join(root, 'verify-data.mjs'), [source, backupFile], env, 180000))
    console.log('SCHEMA_40_READ_ONLY_POSTFLIGHT')
    process.exit(0)
  }
  requiredPreflight(source, env)
  if (phase === 'preflight') { console.log('SCHEMA_38_PREFLIGHT_ONLY'); process.exit(0) }
  if (phase === 'backup-and-restore') {
    if (fs.existsSync(backupFile) || fs.existsSync(proofFile)) fail('BACKUP_ALREADY_EXISTS')
    const key = await hidden('Existing backup encryption key (hidden)')
    const restoreUrl = process.env.CAMPUSPAY_LOCAL_RESTORE_URL
      ?? await hidden('Disposable localhost PostgreSQL restore URL (hidden)')
    if (!key || !restoreUrl) fail('BACKUP_OR_LOCAL_RESTORE_INPUT_MISSING')
    env.CAMPUSPAY_BACKUP_KEY = key
    env.RESTORE_TEST_DATABASE_URL = restoreUrl
    console.log(run(source, path.join(source, 'scripts/backup-database.mjs'), ['backup', backupFile], env, 180000))
    console.log(run(source, path.join(source, 'scripts/backup-database.mjs'), ['verify-restore', backupFile], env, 180000))
    writeNew(proofFile, { status: 'BACKUP_AND_LOCAL_RESTORE_VERIFIED', source: manifest.head,
      tree: manifest.tree, historyRows: 38, file: backupFile, sha256: hash(backupFile),
      verifiedAt: new Date().toISOString() })
    console.log('BACKUP_AND_LOCAL_RESTORE_VERIFIED')
    process.exit(0)
  }
  if (fs.existsSync(attemptFile)) fail('ATTEMPT_ALREADY_STARTED_INSPECT_HISTORY')
  verifiedBackup()
  env.CAMPUSPAY_BACKUP_KEY = await hidden('Existing backup encryption key (hidden)')
  console.log(run(source, path.join(root, 'verify-data.mjs'), [source, backupFile], env, 180000))
  writeNew(attemptFile, { status: 'MIGRATION_ATTEMPT_STARTED', source: manifest.head,
    tree: manifest.tree, pending: manifest.pending, startedAt: new Date().toISOString() })
  attemptStarted = true
  const migration = run(source, path.join(source, 'scripts/migrate.mjs'), ['--check-runtime'], env, 600000)
  const applied = migration.split(/\r?\n/).filter(line => line.startsWith('Applied '))
  if (JSON.stringify(applied) !== JSON.stringify(manifest.pending.map(version => `Applied ${version}`))) fail('MIGRATION_RESULT_UNCERTAIN')
  console.log(JSON.stringify({ status: 'EXACT_MIGRATIONS_APPLIED', applied: manifest.pending }))
  console.log(run(source, path.join(root, 'probe.mjs'), ['after', source], env))
  console.log(run(source, path.join(root, 'verify-data.mjs'), [source, backupFile], env, 180000))
  console.log('SCHEMA_40_VERIFIED_APP_RELEASE_PENDING')
} catch (error) {
  const code = /^[A-Z_]+$/.test(error?.message ?? '') ? error.message : 'OPERATOR_STEP_FAILED'
  console.error(`STOP: ${code}. ${attemptStarted ? 'Keep maintenance enabled; inspect exact history before any retry.' : 'No migration attempt started in this invocation; inspect existing evidence before another apply.'}`)
  process.exitCode = 1
}
