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
  } finally { await owner.query('insert into private.schema_migrations(version,applied_at) values($1,$2)', [missing.version, missing.applied_at]) }
  const unexpected = '20990101000000_preflight_probe'
  try {
    await owner.query('insert into private.schema_migrations(version) values($1)', [unexpected])
    await assert.rejects(run({}), error => error.stderr.includes('UNEXPECTED_SCHEMA_VERSION'))
  } finally { await owner.query('delete from private.schema_migrations where version=$1', [unexpected]) }
  await assert.rejects(run({ EXPECTED_DATABASE_HOST: 'wrong-target.invalid' }), error => error.stderr.includes('Migration target does not match'))
  assert.deepEqual((await owner.query('select * from private.schema_migrations order by version')).rows, before)
  console.log('PASS: migration preflight is read-only and rejects gaps, unknown versions, and wrong targets')
}
