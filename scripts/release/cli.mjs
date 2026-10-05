import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import pg from 'pg'
import { backupDatabase, verifyRestore } from '../backup-database.mjs'
import { runMigrations } from '../lib/migration-runner.mjs'
import { checkBackupMatchesLive, checkQuiescence, releaseGuard } from './database.mjs'
import { githubGate, githubGet } from './github.mjs'
import { verifyVercelHold } from './vercel.mjs'
import { checkArtifact, checkBackupPolicy, checkDatabaseUrl, checkFiles, GateError, policy, requireThat, sha256 } from './policy.mjs'

const env = process.env, step = process.argv[2]
const candidateDirectory = path.resolve('release-candidate')
const migrations = path.join(candidateDirectory, 'database/migrations')
const temporary = path.join(env.RUNNER_TEMP || '/tmp', 'campuspay-release')
const archive = path.join(temporary, 'out', 'campuspay.cpbackup')
const downloaded = path.join(temporary, 'downloaded', 'campuspay.cpbackup')
const approved = ['campuspay-backup', 'campuspay-production']
const hold = completed => verifyVercelHold({ token: env.VERCEL_READ_TOKEN, deploymentId: env.DEPLOYMENT_ID, completed })
const summary = line => { if (env.GITHUB_STEP_SUMMARY) fs.appendFileSync(env.GITHUB_STEP_SUMMARY, `${line}\n`) }
const output = (key, value) => fs.appendFileSync(env.GITHUB_OUTPUT, `${key}=${value}\n`)

function candidate() {
  const revision = execFileSync('git', ['-C', candidateDirectory, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
  const tree = execFileSync('git', ['-C', candidateDirectory, 'rev-parse', 'HEAD^{tree}'], { encoding: 'utf8' }).trim()
  requireThat(revision === policy.candidate && tree === policy.candidateTree, 'CANDIDATE_SOURCE_CHANGED')
  checkFiles(migrations)
}
async function withDatabase(callback, readOnly = false) {
  checkDatabaseUrl(env.CAMPUSPAY_OWNER_URL)
  const client = new pg.Client({ connectionString: env.CAMPUSPAY_OWNER_URL, connectionTimeoutMillis: 15000 })
  try {
    await client.connect()
    await client.query("set statement_timeout='120s'")
    await client.query("set lock_timeout='15s'")
    await client.query("set timezone='UTC'")
    if (readOnly) await client.query('set default_transaction_read_only=on')
    return await callback(client)
  } finally { await client.end() }
}
function receipt(name) {
  fs.mkdirSync(path.join(temporary, 'receipt'), { recursive: true, mode: 0o700 })
  fs.writeFileSync(path.join(temporary, 'receipt', 'result.json'), JSON.stringify({
    result: name, run: env.GITHUB_RUN_ID, candidate: policy.candidate, tooling: env.GITHUB_SHA,
    databaseHost: policy.databaseHost, databaseName: policy.databaseName, deployment: env.DEPLOYMENT_ID || null,
  }) + '\n', { mode: 0o600 })
}
async function artifact() {
  requireThat(/^\d+$/.test(env.BACKUP_ARTIFACT_ID ?? ''), 'BACKUP_ARTIFACT_REQUIRED')
  const record = await githubGet(`/actions/artifacts/${env.BACKUP_ARTIFACT_ID}`)
  checkArtifact(record, { runId: env.GITHUB_RUN_ID, toolingSha: env.GITHUB_SHA, digest: env.BACKUP_ARTIFACT_DIGEST,
    name: `campuspay-encrypted-backup-${env.GITHUB_RUN_ID}` })
  return record
}

try {
  requireThat(['gate', 'approve-backup', 'preflight', 'backup', 'retained', 'migrate', 'verify-cutover'].includes(step), 'INVALID_RELEASE_STEP')
  if (step === 'gate') {
    await githubGate()
    summary(`Verified protected manual workflow. Application candidate: \`${policy.candidate}\`.`)
  } else if (step === 'approve-backup') {
    requireThat(env.RELEASE_MODE === 'release', 'INVALID_RELEASE_STEP')
    checkBackupPolicy(env.BACKUP_DESTINATION_POLICY)
    await githubGate({ approved: ['campuspay-backup'] })
    summary('Owner approved this run’s encrypted backup destination: private repository Actions artifact; 90-day retention; repository readers can download ciphertext; maintainers can delete it.')
  } else {
    candidate()
    if (step === 'preflight' || step === 'verify-cutover') {
      requireThat(env.RELEASE_MODE === step, 'INVALID_RELEASE_STEP')
      await githubGate({ approved: ['campuspay-preflight'] })
      if (step === 'verify-cutover') await hold(true)
      await withDatabase(client => runMigrations(client, { directory: migrations, preflight: true,
        beforeApply: state => releaseGuard(state, { completed: step === 'verify-cutover' }),
      }), true)
      receipt(step)
      summary(step === 'preflight' ? 'PASS: exact baseline of 32 migrations, pending 045–049, owner target and runtime grants. No data changed.' :
        'PASS: all 37 migrations, runtime grants and exact production deployment aliases verified while traffic remains held. Reopening still requires operator smoke checks.')
    } else {
      requireThat(env.RELEASE_MODE === 'release', 'INVALID_RELEASE_STEP')
      checkBackupPolicy(env.BACKUP_DESTINATION_POLICY)
      await githubGate({ approved })
      if (step === 'backup') {
        await hold(false)
        await withDatabase(client => runMigrations(client, { directory: migrations, preflight: true,
          beforeApply: state => releaseGuard(state, { beforeMigration: checkQuiescence }),
        }), true)
        fs.mkdirSync(path.dirname(archive), { recursive: true, mode: 0o700 })
        checkDatabaseUrl(env.CAMPUSPAY_OWNER_URL)
        await backupDatabase(env.CAMPUSPAY_OWNER_URL, env.CAMPUSPAY_BACKUP_KEY, archive, policy.databaseHost)
        output('ciphertext_sha256', sha256(fs.readFileSync(archive)))
        // Upload step receives only this one encrypted file, never plaintext/key.
      } else if (step === 'retained') {
        await artifact()
        summary(`Encrypted backup retained outside runner: artifact ${env.BACKUP_ARTIFACT_ID}; ZIP SHA-256 ${env.BACKUP_ARTIFACT_DIGEST}.`)
      } else {
        await artifact()
        const bytes = fs.readFileSync(downloaded)
        requireThat(sha256(bytes) === env.BACKUP_CIPHERTEXT_SHA256, 'DOWNLOADED_BACKUP_HASH_MISMATCH')
        // This is the downloaded retained copy. Restore accepts only localhost,
        // creates its own random database, compares all table digests and ACLs.
        await verifyRestore('postgresql://postgres:ci-restore-only@localhost:5432/postgres', env.CAMPUSPAY_BACKUP_KEY, downloaded)
        summary('PASS: downloaded encrypted backup authenticated and restored on isolated PostgreSQL; table digests and runtime ACLs matched.')
        await withDatabase(client => runMigrations(client, { directory: migrations,
          beforeApply: state => releaseGuard(state, { beforeMigration: async connection => {
            await githubGate({ approved })
            await artifact()
            await hold(false)
            await checkQuiescence(connection)
            await checkBackupMatchesLive(connection, bytes, env.CAMPUSPAY_BACKUP_KEY)
          } }),
          afterApply: async state => { await releaseGuard(state, { completed: true }); await hold(false) },
        }))
        receipt('release')
        summary(`PASS: only migrations 045–049 applied with existing per-file transactions and advisory lock. Keep traffic held. Promote exact deployment \`${env.DEPLOYMENT_ID}\`, then dispatch verify-cutover using this run ID.`)
      }
    }
  }
} catch (error) {
  // Never print SQL errors, HTTP bodies, connection strings or a backup inventory.
  const code = error instanceof GateError ? error.message : 'RELEASE_STEP_FAILED'
  console.error(JSON.stringify({ step, code, action: 'STOP_KEEP_TRAFFIC_HELD_REVIEW_FAILURE' }))
  summary(`FAILED: ${step}; ${code}. No automatic retry, rollback or reopening. Review exact migration history before any new attempt.`)
  process.exitCode = 1
}
