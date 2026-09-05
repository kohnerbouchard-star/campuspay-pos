#!/usr/bin/env node
import pg from 'pg'
const client = new pg.Client({connectionString:process.env.DATABASE_URL, connectionTimeoutMillis:15000})
try {
  await client.connect()
  const {rows:[r]}=await client.query(`select current_database() as database,
    current_user as role, rolsuper or rolbypassrls or rolcreaterole or rolcreatedb as excessive_privileges,
    has_table_privilege(current_user, 'private.wallets','UPDATE') as can_edit_balances,
    has_function_privilege(current_user,'api.catalog(uuid)','EXECUTE') as can_call_api
    from pg_roles where rolname=current_user`)
  if (r.excessive_privileges || r.can_edit_balances || !r.can_call_api) throw new Error('Runtime database role has incorrect privileges')
  console.log('Database connected; restricted runtime role verified.', r.database)
} catch { console.error('Database check failed. Check the connection and runtime role; no credentials are printed.'); process.exitCode=1 }
finally { await client.end() }
