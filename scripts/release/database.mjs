import { inventory } from '../backup-database.mjs'
import { openBackup } from '../lib/backup-envelope.mjs'
import { policy, requireThat, same, checkHistory } from './policy.mjs'

export async function checkRuntime(client) {
  const identity = (await client.query('select current_database() as database, current_user as role')).rows[0]
  requireThat(identity.database === policy.databaseName && identity.role === policy.ownerRole, 'DATABASE_IDENTITY_MISMATCH')
  const roles = (await client.query(`select rolname,rolcanlogin,rolsuper,rolcreatedb,rolcreaterole,rolbypassrls
    from pg_roles where rolname in ('campuspay_runtime','campuspay_runtime_login') order by rolname`)).rows
  requireThat(roles.length === 2 && roles.every(role => !role.rolsuper && !role.rolcreatedb && !role.rolcreaterole && !role.rolbypassrls) &&
    roles[0].rolname === policy.runtimeRole && roles[0].rolcanlogin === false &&
    roles[1].rolname === policy.runtimeLogin && roles[1].rolcanlogin === true, 'UNSAFE_RUNTIME_ROLES')
  for (const role of [policy.runtimeRole, policy.runtimeLogin]) {
    const rights = (await client.query(`select pg_has_role($1,'campuspay_runtime','MEMBER') as member,
      has_schema_privilege($1,'api','USAGE') as usage,
      has_database_privilege($1,current_database(),'CREATE') as database_create,
      (select bool_or(has_schema_privilege($1,oid,'CREATE')) from pg_namespace
       where nspname in ('public','private','api','extensions')) as schema_create,
      has_function_privilege($1,'api.authorize_session(text,text,text)','EXECUTE') as execute,
      (select count(*)::integer from pg_class c join pg_namespace n on n.oid=c.relnamespace
       where n.nspname in ('private','public') and c.relkind in ('r','p') and
       has_table_privilege($1,c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')) as table_access`, [role])).rows[0]
    requireThat(rights.member && rights.usage && rights.execute && !rights.database_create && !rights.schema_create && rights.table_access === 0, 'UNSAFE_RUNTIME_GRANTS')
    const memberships = (await client.query(`with recursive memberships(oid) as (
      select roleid from pg_auth_members where member=(select oid from pg_roles where rolname=$1)
      union select m.roleid from pg_auth_members m join memberships p on m.member=p.oid
    ) select rolname from memberships join pg_roles using(oid)`, [role])).rows
    requireThat(memberships.every(r => role === policy.runtimeLogin && r.rolname === policy.runtimeRole), 'UNSAFE_RUNTIME_MEMBERSHIP')
  }
}

export async function checkQuiescence(client) {
  const drawers = (await client.query('select count(*)::integer as n from private.cash_shifts where closed_at is null')).rows[0].n
  requireThat(drawers === 0, 'OPEN_DRAWERS_BLOCK_RELEASE')
  const active = (await client.query(`select count(*)::integer as n from pg_stat_activity where datname=current_database()
    and pid<>pg_backend_pid() and (state is null or state<>'idle')`)).rows[0].n
  requireThat(active === 0, 'DATABASE_ACTIVITY_BLOCKS_RELEASE')
}

export async function checkBackupMatchesLive(client, bytes, key, now = Date.now()) {
  const { metadata } = openBackup(bytes, key)
  const age = now - Date.parse(metadata.captured_at)
  requireThat(metadata.database === policy.databaseName && age >= 0 && age <= 30 * 60000, 'BACKUP_STALE_OR_WRONG_DATABASE')
  requireThat(same(await inventory(client), metadata.tables), 'LIVE_DATA_CHANGED_SINCE_BACKUP')
}

// The shared runner invokes this before its first DDL, under advisory lock
// 84632291. A failed/partial earlier attempt is deliberately not auto-resumed.
export async function releaseGuard(state, { completed = false, beforeMigration = async () => {} } = {}) {
  // The runner's intended result is not completion evidence. Re-read committed
  // history while the same lock is held, including after the final migration.
  const applied = completed ? (await state.client.query('select version from private.schema_migrations order by version')).rows.map(row => row.version) : state.applied
  checkHistory(applied, state.pending, completed)
  await checkRuntime(state.client)
  if (!completed) await beforeMigration(state.client)
}
