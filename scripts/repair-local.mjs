#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { parseEnv } from 'node:util'
import { createRequire } from 'node:module'
import { spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { TARGET, fail, safeFailure, repairEnvironment, assertNoOverrides, checkRuntime } from './lib/local-readiness.mjs'

let repo = path.join(os.homedir(), 'campuspay-pos')
let checkOnly = false
let start = true
function run(command, args, capture = false, errorCode = 'REPO_UNSAFE') {
  const result = spawnSync(command, args, { cwd: repo, encoding: 'utf8', stdio: capture ? 'pipe' : 'inherit' })
  if (result.error || result.status !== 0) fail(errorCode)
  return (result.stdout || '').trim()
}
try {
  const [major, minor] = process.versions.node.split('.').map(Number)
  if (major < 22 || (major === 22 && minor < 9)) fail('NODE_UNSUPPORTED')
  const args = process.argv.slice(2)
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--repo' && args[i + 1] && !args[i + 1].startsWith('--')) repo = path.resolve(args[++i])
    else if (args[i] === '--check-only') checkOnly = true
    else if (args[i] === '--no-start') start = false
    else fail('ARGUMENT_INVALID')
  }
  if (!fs.existsSync(path.join(repo, '.git'))) fail('REPO_UNSAFE')
  const remote = run('git', ['remote', 'get-url', 'origin'], true)
  if (!/^(?:https:\/\/github\.com\/|git@github\.com:)kohnerbouchard-star\/campuspay-pos(?:\.git)?$/.test(remote)) fail('REPO_UNSAFE')
  if (run('git', ['branch', '--show-current'], true) !== 'main' || run('git', ['status', '--porcelain'], true)) fail('REPO_UNSAFE')
  const envPath = path.join(repo, '.env.local')
  if (!fs.existsSync(envPath) || !fs.lstatSync(envPath).isFile() || fs.lstatSync(envPath).isSymbolicLink()) fail('ENV_FILE_UNSAFE')
  if (run('git', ['ls-files', '--', '.env.local'], true)) fail('ENV_FILE_UNSAFE')
  run('git', ['check-ignore', '-q', '.env.local'], true)
  const original = fs.readFileSync(envPath, 'utf8')
  const repair = repairEnvironment(original)
  const developmentPath = path.join(repo, '.env.development.local')
  const development = fs.existsSync(developmentPath) ? parseEnv(fs.readFileSync(developmentPath, 'utf8')) : {}
  assertNoOverrides(repair.values, process.env, development)
  console.log('CampusPay local repair: verified target, preserved secrets, no database migration or bootstrap.')
  if (checkOnly) {
    console.log(repair.changed ? 'Configuration repair is needed. No files changed.' : 'Configuration already matches. No files changed.')
    process.exitCode = repair.changed ? 2 : 0
  } else {
    run('git', ['fetch', 'origin', 'main'])
    const ancestry = spawnSync('git', ['merge-base', '--is-ancestor', TARGET.minimumCommit, 'origin/main'], { cwd: repo, stdio: 'ignore' })
    if (ancestry.error || ancestry.status !== 0) fail('CHECKOUT_OLD')
    if (run('git', ['rev-list', '--count', 'origin/main..HEAD'], true) !== '0') fail('REPO_UNSAFE')
    run('git', ['merge', '--ff-only', 'origin/main'])
    // Recheck the file after fetching; never overwrite edits made during the update.
    if (fs.readFileSync(envPath, 'utf8') !== original) fail('ENV_FILE_UNSAFE')
    if (repair.changed) {
      const suffix = `${Date.now()}-${randomUUID()}`
      const backup = `${envPath}.backup-${suffix}`
      const temporary = `${envPath}.repair-${suffix}`
      run('git', ['check-ignore', '-q', backup], true)
      run('git', ['check-ignore', '-q', temporary], true)
      fs.writeFileSync(backup, original, { flag: 'wx', mode: 0o600 })
      try {
        fs.writeFileSync(temporary, repair.text, { flag: 'wx', mode: 0o600 })
        fs.renameSync(temporary, envPath)
      } finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary) }
      console.log('Saved a private .env.local.backup-* file beside .env.local and repaired the target.')
    }
    fs.chmodSync(envPath, 0o600)
    run('npm', ['ci', '--no-audit', '--no-fund'], false, 'DEPENDENCIES_FAILED')
    const pg = createRequire(path.join(repo, 'package.json'))('pg')
    const client = new pg.Client({ connectionString: repair.values.DATABASE_URL, connectionTimeoutMillis: 15_000, query_timeout: 10_000 })
    try {
      await client.connect()
      const result = await checkRuntime(client, repair.values)
      console.log(`Runtime login and ${result.capabilities} required API capabilities verified. No purchase was made.`)
    } finally { await client.end() }
    console.log(`Checkout: ${run('git', ['rev-parse', '--short=12', 'HEAD'], true)}`)
    console.log('Staff: http://localhost:3000 | Store: http://localhost:3000/store | Fulfillment: http://localhost:3000/orders')
    if (start) run('npm', ['run', 'dev', '--', '--port', '3000'], false, 'START_FAILED')
  }
} catch (error) {
  console.error(safeFailure(error))
  console.error('No passwords or application secrets were printed. Normal startup never runs migrations.')
  process.exitCode = 1
}
