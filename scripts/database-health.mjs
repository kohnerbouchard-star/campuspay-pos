#!/usr/bin/env node
import pg from 'pg'

const client = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  connectionTimeoutMillis: 15_000,
})

function safeDatabaseError(error) {
  const code = typeof error?.code === 'string' ? error.code : 'UNKNOWN'
  const message = typeof error?.message === 'string'
    ? error.message
        .replace(/postgres(?:ql)?:\/\/[^@\s]+@/gi, 'postgresql://<redacted>@')
        .replace(/npg_[A-Za-z0-9_-]+/g, '<redacted>')
    : 'Unknown database error'
  return `${code}: ${message}`
}

try {
  await client.connect()
  const { rows: [r] } = await client.query(`
    select
      current_database() as database,
      current_user as role,
      rolsuper or rolbypassrls or rolcreaterole or rolcreatedb as excessive_privileges,
      wallet_oid,
      has_table_privilege(current_user, wallet_oid, 'UPDATE') as can_edit_balances,
      has_function_privilege(current_user, 'api.catalog(uuid)', 'EXECUTE') as can_call_api
    from pg_roles
    cross join lateral (
      select c.oid as wallet_oid
      from pg_catalog.pg_class c
      join pg_catalog.pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'private' and c.relname = 'wallets'
      limit 1
    ) wallet
    where rolname = current_user
  `)

  if (!r || !r.wallet_oid || r.excessive_privileges || r.can_edit_balances || !r.can_call_api) {
    throw new Error('Runtime database role has incorrect privileges or the expected schema is missing')
  }

  console.log('Database connected; restricted runtime role verified.', r.database)
} catch (error) {
  console.error(`Database check failed (${safeDatabaseError(error)}). No credentials are printed.`)
  process.exitCode = 1
} finally {
  await client.end()
}
