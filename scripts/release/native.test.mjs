// Disposable PostgreSQL only. This does not invoke the production CLI or APIs.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { randomBytes } from 'node:crypto'
import pg from 'pg'
import { backupDatabase, verifyRestore } from '../backup-database.mjs'
import { runMigrations } from '../lib/migration-runner.mjs'
import { checkBackupMatchesLive, checkQuiescence, releaseGuard } from './database.mjs'
import { checkFiles, checkHistory, policy, versions, sha256 } from './policy.mjs'

test('native release rehearsal: backup restore, grants, drift, lock, exact five and recovery', async () => {
  assert.equal(process.env.CI, 'true')
  const url = new URL(process.env.RELEASE_TEST_DATABASE_URL)
  assert.ok(['localhost', '127.0.0.1'].includes(url.hostname))
  assert.equal(url.pathname, '/campuspay')
  assert.equal(url.search, '')
  const candidate = path.resolve(process.env.RELEASE_TEST_CANDIDATE_DIRECTORY || 'release-candidate', 'database/migrations')
  checkFiles(candidate)
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-release-native-'))
  const baseline = path.join(directory, 'baseline')
  fs.mkdirSync(baseline)
  for (const row of policy.baseline) fs.copyFileSync(path.join(candidate, `${row.version}.sql`), path.join(baseline, `${row.version}.sql`))
  const client = new pg.Client({ connectionString: url.href }), observer = new pg.Client({ connectionString: url.href })
  const report = () => {}
  try {
    await client.connect(); await observer.connect()
    // Refuse any existing database: this rehearsal owns only a fresh fixture.
    assert.equal((await client.query("select to_regnamespace('private') as n")).rows[0].n, null)
    await runMigrations(client, { directory: baseline, report })
    await client.query("create role campuspay_owner login superuser password 'ci-local-owner-only'")
    await client.query("create role campuspay_runtime_login login password 'ci-local-runtime-only'")
    await client.query('grant campuspay_runtime to campuspay_runtime_login')
    await client.query('set role campuspay_owner')
    await client.query("set timezone='UTC'")
    await client.query('create table private.release_test_fixture(value integer not null)')
    await client.query('insert into private.release_test_fixture values(7)')
    const history = async () => (await client.query('select version from private.schema_migrations order by version')).rows.map(r => r.version)
    const monetary = async () => (await client.query("select count(*)::integer n,md5(coalesce(string_agg(to_jsonb(t)::text,E'\\n' order by to_jsonb(t)::text collate \"C\"),'')) digest from private.wallet_ledger t")).rows[0]
    const baselineHistory = await history(), beforeMoney = await monetary()
    assert.deepEqual(baselineHistory, versions(policy.baseline))
    const runner = options => runMigrations(client, { directory: candidate, report, ...options })
    await client.query('set default_transaction_read_only=on')
    await runner({ preflight: true, beforeApply: releaseGuard })
    await client.query('set default_transaction_read_only=off')
    assert.deepEqual(await history(), baselineHistory)

    await client.query('grant select on private.release_test_fixture to campuspay_runtime_login')
    await assert.rejects(runner({ beforeApply: releaseGuard }), /UNSAFE_RUNTIME_GRANTS/)
    await client.query('revoke select on private.release_test_fixture from campuspay_runtime_login')
    await client.query('grant select(value) on private.release_test_fixture to campuspay_runtime_login')
    await assert.rejects(runner({ beforeApply: releaseGuard }), /UNSAFE_RUNTIME_GRANTS/)
    await client.query('revoke select(value) on private.release_test_fixture from campuspay_runtime_login')
    await client.query('create view private.release_test_view as select value from private.release_test_fixture')
    await client.query('grant select on private.release_test_view to campuspay_runtime_login')
    await assert.rejects(runner({ beforeApply: releaseGuard }), /UNSAFE_RUNTIME_GRANTS/)
    await client.query('drop view private.release_test_view')
    await client.query('create sequence private.release_test_sequence')
    await client.query('grant usage on sequence private.release_test_sequence to campuspay_runtime_login')
    await assert.rejects(runner({ beforeApply: releaseGuard }), /UNSAFE_RUNTIME_GRANTS/)
    await client.query('drop sequence private.release_test_sequence')
    await client.query('create function private.release_test_function() returns integer language sql as $$ select 1 $$')
    await client.query('revoke all on function private.release_test_function() from public')
    await client.query('grant execute on function private.release_test_function() to campuspay_runtime_login')
    await assert.rejects(runner({ beforeApply: releaseGuard }), /UNSAFE_RUNTIME_GRANTS/)
    await client.query('drop function private.release_test_function()')
    await client.query('alter role campuspay_runtime_login bypassrls')
    await assert.rejects(runner({ beforeApply: releaseGuard }), /UNSAFE_RUNTIME_ROLES/)
    await client.query('alter role campuspay_runtime_login nobypassrls')
    await client.query('create role release_unsafe_parent nologin')
    await client.query('grant release_unsafe_parent to campuspay_runtime_login')
    await assert.rejects(runner({ beforeApply: releaseGuard }), /UNSAFE_RUNTIME_MEMBERSHIP/)
    await client.query('revoke release_unsafe_parent from campuspay_runtime_login')
    await client.query('drop role release_unsafe_parent')
    assert.deepEqual(await history(), baselineHistory)

    await observer.query('begin')
    await assert.rejects(checkQuiescence(client), /DATABASE_ACTIVITY/)
    await observer.query('rollback')
    await checkQuiescence(client)
    const key = randomBytes(32).toString('base64'), archive = path.join(directory, 'synthetic.cpbackup')
    const owner = new URL(url); owner.username = 'campuspay_owner'; owner.password = 'ci-local-owner-only'
    await backupDatabase(owner.href, key, archive, owner.hostname)
    // Emulate retention/download in a different directory; artifact API identity
    // and retention are tested separately. No synthetic/live upload is performed.
    const retained = path.join(directory, 'external-fixture'); fs.mkdirSync(retained)
    const downloaded = path.join(retained, 'downloaded.cpbackup'); fs.copyFileSync(archive, downloaded)
    const bytes = fs.readFileSync(downloaded)
    assert.equal(sha256(bytes), sha256(fs.readFileSync(archive)))
    fs.unlinkSync(archive)
    await assert.rejects(verifyRestore(url.href, randomBytes(32).toString('base64'), downloaded), /AUTHENTICATION/)
    const corrupt = path.join(directory, 'corrupt.cpbackup'), damaged = Buffer.from(bytes); damaged[damaged.length - 1] ^= 1
    fs.writeFileSync(corrupt, damaged)
    await assert.rejects(verifyRestore(url.href, key, corrupt), /AUTHENTICATION/)
    assert.deepEqual(await history(), baselineHistory)
    const restored = await verifyRestore(url.href, key, downloaded)
    assert.equal(restored.integrity, 'matched')
    assert.equal(restored.runtime_direct_table_grants, 0)
    assert.equal((await observer.query("select count(*)::integer n from pg_database where datname ~ '^cp_restore_[a-f0-9]{20}$'")).rows[0].n, 0)
    await checkBackupMatchesLive(client, bytes, key)
    await assert.rejects(checkBackupMatchesLive(client, bytes, key, Date.now() + 31 * 60000), /BACKUP_STALE/)
    await client.query('update private.release_test_fixture set value=8')
    await assert.rejects(runner({ beforeApply: state => releaseGuard(state, { beforeMigration: c => checkBackupMatchesLive(c, bytes, key) }) }), /LIVE_DATA_CHANGED/)
    assert.deepEqual(await history(), baselineHistory)
    await client.query('update private.release_test_fixture set value=7')

    const order = ['retained-copy-restored']
    await runner({ beforeApply: state => releaseGuard(state, { beforeMigration: async c => {
      order.push('locked-gates')
      assert.equal((await observer.query('select pg_try_advisory_lock(84632291) as locked')).rows[0].locked, false)
      await checkQuiescence(c)
      await checkBackupMatchesLive(c, bytes, key)
    } }), report: message => { if (message.startsWith('Applied ')) order.push(message.slice(8)) },
    afterApply: state => releaseGuard(state, { completed: true }) })
    assert.deepEqual(order, ['retained-copy-restored', 'locked-gates', ...versions(policy.pending)])
    assert.deepEqual(await monetary(), beforeMoney)
    checkHistory(await history(), [], true)
    await assert.rejects(runner({ beforeApply: releaseGuard }), /EXACT_RELEASE_HISTORY_REQUIRED/)
    assert.equal((await observer.query('select pg_try_advisory_lock(84632291) as locked')).rows[0].locked, true)
    await observer.query('select pg_advisory_unlock(84632291)')

    // Exercise actual per-file transaction behavior after a successful release,
    // using two additional synthetic files solely inside this disposable DB.
    const broken = path.join(directory, 'broken'); fs.mkdirSync(broken)
    for (const row of [...policy.baseline, ...policy.pending]) fs.copyFileSync(path.join(candidate, `${row.version}.sql`), path.join(broken, `${row.version}.sql`))
    fs.writeFileSync(path.join(broken, '20990101000100_synthetic_first.sql'), 'create table private.synthetic_committed(value integer);')
    fs.writeFileSync(path.join(broken, '20990101000200_synthetic_failure.sql'), "create table private.synthetic_rolled_back(value integer); do $$ begin raise exception 'synthetic'; end $$;")
    await assert.rejects(runMigrations(client, { directory: broken, report }), /synthetic/)
    assert.equal((await client.query("select to_regclass('private.synthetic_committed') a,to_regclass('private.synthetic_rolled_back') b")).rows[0].b, null)
    assert.equal((await history()).at(-1), '20990101000100_synthetic_first')
    assert.equal((await client.query("select count(*)::integer n from private.schema_migrations where version='20990101000200_synthetic_failure'")).rows[0].n, 0)
    await assert.rejects(releaseGuard({ client, applied: versions([...policy.baseline, ...policy.pending]), pending: [] }, { completed: true }), /EXACT_RELEASE_HISTORY_REQUIRED/)
    assert.throws(() => checkHistory([...versions(policy.baseline), policy.pending[0].version], versions(policy.pending).slice(1)))
    console.log('PASS: native PostgreSQL release guards, restored retained-copy fixture, unchanged wallet ledger, exact five migrations, original lock and per-file rollback. No production access.')
  } finally {
    await client.end(); await observer.end()
    fs.rmSync(directory, { recursive: true, force: true })
  }
})
