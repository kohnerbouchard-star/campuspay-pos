import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execute = promisify(execFile)
export async function runMigrationPreflightChecks(owner) {
  const env = { ...process.env }
  const run = overrides => execute(process.execPath, ['scripts/migrate.mjs', '--preflight', '--check-runtime'], { env: { ...env, ...overrides } })
  const before = (await owner.query('select * from private.schema_migrations order by version')).rows
  const success = await run({})
  assert.ok(success.stdout.includes('"pending_migrations":[]'))
  const missing = before.at(-2)
  try {
    await owner.query('delete from private.schema_migrations where version=$1', [missing.version])
    await assert.rejects(run({}), error => error.stderr.includes('MIGRATION_GAP'))
  } finally { await owner.query('insert into private.schema_migrations(version,applied_at,checksum_sha256) values($1,$2,$3)', [missing.version, missing.applied_at, missing.checksum_sha256]) }
  const checksummed = before.find(row => row.checksum_sha256)
  assert.ok(checksummed, 'Fresh migrations must record their actual executed checksum')
  try {
    await owner.query('update private.schema_migrations set checksum_sha256=$2 where version=$1', [checksummed.version, '0'.repeat(64)])
    await assert.rejects(run({}), error => error.stderr.includes('APPLIED_MIGRATION_CHANGED'))
  } finally { await owner.query('update private.schema_migrations set checksum_sha256=$2 where version=$1', [checksummed.version, checksummed.checksum_sha256]) }
  const unexpected = '20990101000000_preflight_probe'
  try {
    await owner.query('insert into private.schema_migrations(version) values($1)', [unexpected])
    await assert.rejects(run({}), error => error.stderr.includes('UNEXPECTED_SCHEMA_VERSION'))
  } finally { await owner.query('delete from private.schema_migrations where version=$1', [unexpected]) }
  await assert.rejects(run({ EXPECTED_DATABASE_HOST: 'wrong-target.invalid' }), error => error.stderr.includes('Migration target does not match'))
  assert.deepEqual((await owner.query('select * from private.schema_migrations order by version')).rows, before)
  console.log('PASS: migration preflight is read-only and rejects changed applied checksums, gaps, unknown versions, and wrong targets')
}
