import fs from 'node:fs'
import path from 'node:path'

// Shared by the existing operator CLI and the protected release workflow. Hooks
// run on this connection while the original migration advisory lock is held.
export async function runMigrations(client, {
  directory = 'database/migrations', preflight = false, requireRuntime = false,
  beforeApply = async () => {}, afterApply = async () => {}, report = console.log,
} = {}) {
  const versions = fs.readdirSync(directory).filter(f => f.endsWith('.sql')).sort().map(f => f.slice(0, -4))
  let applying = null
  await client.query('select pg_advisory_lock(84632291)')
  try {
    const owner = (await client.query("select has_database_privilege(current_user,current_database(),'CREATE') or case when to_regnamespace('private') is not null then has_schema_privilege(current_user,'private','CREATE') else false end as owner_access")).rows[0]
    if (!owner.owner_access) throw new Error('OWNER_CONNECTION_REQUIRED')
    const exists = (await client.query("select to_regclass('private.schema_migrations') as relation")).rows[0].relation
    const applied = exists ? (await client.query('select version from private.schema_migrations order by version')).rows.map(row => row.version) : []
    if (applied.some(version => !versions.includes(version))) throw new Error('UNEXPECTED_SCHEMA_VERSION')
    const last = Math.max(-1, ...applied.map(version => versions.indexOf(version)))
    if (versions.slice(0, last + 1).some(version => !applied.includes(version))) throw new Error('MIGRATION_GAP')
    const pending = versions.filter(version => !applied.includes(version))
    report(JSON.stringify({ current_schema_version: applied.at(-1) ?? null, pending_migrations: pending }))
    if (requireRuntime) {
      const role = (await client.query("select rolcanlogin,rolsuper,rolcreatedb,rolcreaterole from pg_roles where rolname='campuspay_runtime'")).rows[0]
      if (!role || Object.values(role).some(Boolean)) throw new Error('INVALID_RUNTIME_ROLE')
      const access = await client.query("select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='private' and c.relkind in ('r','p') and has_table_privilege('campuspay_runtime',c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') limit 1")
      if (access.rowCount) throw new Error('RUNTIME_HAS_PRIVATE_TABLE_ACCESS')
      const api = (await client.query("select has_schema_privilege('campuspay_runtime','api','USAGE') as usage,has_function_privilege('campuspay_runtime','api.authorize_session(text,text,text)','EXECUTE') as execute")).rows[0]
      if (!api.usage || !api.execute) throw new Error('RUNTIME_API_GRANT_MISSING')
      report('Runtime role preflight passed.')
    }
    await beforeApply({ client, applied, pending, versions })
    if (!preflight) {
      await client.query('create schema if not exists private')
      await client.query('create table if not exists private.schema_migrations(version text primary key, applied_at timestamptz not null default now())')
      for (const version of pending) {
        applying = version
        await client.query('begin')
        try {
          await client.query(fs.readFileSync(path.join(directory, `${version}.sql`), 'utf8'))
          await client.query('insert into private.schema_migrations(version) values($1) on conflict do nothing', [version])
          await client.query('commit')
          report(`Applied ${version}`)
        } catch (error) { await client.query('rollback'); throw error }
      }
      await afterApply({ client, applied: [...applied, ...pending], pending: [] })
    }
    return { applied, pending }
  } catch (error) {
    error.migration = applying
    throw error
  } finally { await client.query('select pg_advisory_unlock(84632291)') }
}
