import { parseEnv } from 'node:util'

// Endpoint identities are not credentials. Update only after a verified cutover.
export const TARGET = Object.freeze({
  host: 'ep-broad-tooth-az9zz1z8.c-3.ap-southeast-1.aws.neon.tech',
  legacyHost: 'ep-old-water-azi2h12m.c-3.ap-southeast-1.aws.neon.tech',
  database: 'campuspay',
  role: 'campuspay_runtime_login',
  minimumCommit: '73470a2b9b0941a1e2533943e31ef7a03a7f74d2',
})
export const REQUIRED_SECRETS = [
  'CARD_HMAC_SECRET', 'COUPON_HMAC_SECRET', 'STAFF_PIN_PEPPER',
  'STUDENT_PIN_PEPPER', 'SESSION_HMAC_SECRET', 'TERMINAL_COOKIE_SECRET',
]
export const REQUIRED_APIS = [
  'api.authorize_session(text,text,text)', 'api.catalog(uuid)',
  'api.terminal_payment_policy_v2(uuid)',
  'api.finalize_payment_tender(uuid,uuid,bigint)',
  'api.confirm_payment(uuid,uuid,text,bigint)',
  'api.enroll_student(uuid,text,text,text,text,uuid)',
  'api.student_wallet_history(uuid,uuid)',
  'api.recover_wallet_adjustment(uuid,uuid)',
  'api.recover_stock_receipt(uuid,uuid)',
  'api.authorize_customer_session(text)', 'api.store_catalog(uuid)',
  'api.store_delivery_locations(uuid)',
  'api.create_online_order(uuid,jsonb,text,uuid,text,uuid,bigint)',
  'api.recover_online_order(uuid,uuid)',
  'api.update_online_order_status(uuid,uuid,text)',
]
export const MESSAGES = Object.freeze({
  CONFIG_INVALID: 'The database URL or local configuration is invalid.',
  SECRETS_MISSING: 'An existing application secret is missing. Restore the private configuration; do not generate new peppers.',
  DATABASE_URL_DUPLICATE: 'DATABASE_URL must have exactly one single-line definition.',
  TARGET_UNRECOGNIZED: 'This repair only accepts the verified CampusPay main or legacy endpoint. Other databases are untouched.',
  TARGET_IDENTITY: 'Expected database campuspay and login campuspay_runtime_login. Do not use an owner login.',
  TARGET_MISMATCH: 'The connection does not match the configured expected database target.',
  SSL_UNSAFE: 'A Neon runtime connection must use sslmode=verify-full without alternate SSL overrides.',
  ENV_OVERRIDE: 'A shell variable or .env.development.local overrides .env.local. Remove the conflicting override and retry.',
  RUNTIME_PRIVILEGES: 'The runtime role is missing or has unexpected privileges. Do not grant access to private tables.',
  SCHEMA_CAPABILITIES: 'Required API signatures or execution grants are missing. Select the matching database; do not migrate the legacy branch.',
  CONNECTION_FAILED: 'Database connection failed. Check network, endpoint, and the current runtime password.',
  DEPENDENCIES_FAILED: 'Dependency installation failed. Review npm output; the private configuration backup is retained.',
  START_FAILED: 'The development server stopped or could not start. Check whether port 3000 is already in use.',
  REPO_UNSAFE: 'Use the expected CampusPay repository on a clean main branch. Local changes have not been discarded.',
  CHECKOUT_OLD: 'origin/main does not contain the verified September 10 baseline.',
  ENV_FILE_UNSAFE: '.env.local must be a regular, Git-ignored, untracked file, not a symbolic link.',
  NODE_UNSUPPORTED: 'Node.js 22.9 or newer is required.',
  ARGUMENT_INVALID: 'Use --repo PATH, --check-only, or --no-start.',
})
export function fail(code) { throw Object.assign(new Error(code), { safeCode: code }) }
export function safeFailure(error) {
  const code = Object.hasOwn(MESSAGES, error?.safeCode) ? error.safeCode : 'CONNECTION_FAILED'
  const detail = typeof error?.code === 'string' && /^(?:[0-9A-Z]{5}|ENOTFOUND|ECONNREFUSED|ETIMEDOUT|ECONNRESET|EHOSTUNREACH)$/.test(error.code)
    ? ` [${error.code}]` : ''
  return `${code}${detail}: ${MESSAGES[code]}`
}
export function canonicalHost(host) { return host.toLowerCase().replace(/-pooler(?=\.)/, '') }
export function connectionURL(raw) {
  try {
    const u = new URL(raw)
    if (!['postgres:', 'postgresql:'].includes(u.protocol) || !u.hostname || !u.username || !u.password || u.hash) fail('CONFIG_INVALID')
    return u
  } catch { fail('CONFIG_INVALID') }
}
function setLine(text, key, value) {
  const pattern = new RegExp(`^[ \\t]*(?:export[ \\t]+)?${key}[ \\t]*=.*$`, 'gm')
  const matches = text.match(pattern) || []
  if (matches.length > 1) fail('CONFIG_INVALID')
  const line = `${key}=${value}`
  return matches.length ? text.replace(pattern, () => line) : `${text}${text.endsWith('\n') ? '' : '\n'}${line}\n`
}
export function repairEnvironment(text) {
  let values
  try { values = parseEnv(text) } catch { fail('CONFIG_INVALID') }
  if (REQUIRED_SECRETS.some(key => !values[key])) fail('SECRETS_MISSING')
  if ((text.match(/^[ \t]*(?:export[ \t]+)?DATABASE_URL[ \t]*=/gm) || []).length !== 1 || /[\r\n]/.test(values.DATABASE_URL || '')) fail('DATABASE_URL_DUPLICATE')
  const u = connectionURL(values.DATABASE_URL)
  if (![TARGET.host, TARGET.legacyHost].includes(canonicalHost(u.hostname))) fail('TARGET_UNRECOGNIZED')
  if (u.pathname !== `/${TARGET.database}` || decodeURIComponent(u.username) !== TARGET.role || (u.port && u.port !== '5432')) fail('TARGET_IDENTITY')
  // Keep the password, pooler choice, and all application peppers unchanged.
  u.hostname = u.hostname.includes('-pooler.') ? TARGET.host.replace('.', '-pooler.') : TARGET.host
  for (const key of ['ssl', 'sslcert', 'sslkey', 'sslrootcert', 'uselibpqcompat']) u.searchParams.delete(key)
  u.searchParams.set('sslmode', 'verify-full')
  let next = setLine(text, 'DATABASE_URL', JSON.stringify(u.href))
  next = setLine(next, 'EXPECTED_DATABASE_HOST', TARGET.host)
  next = setLine(next, 'EXPECTED_DATABASE_NAME', TARGET.database)
  const updated = parseEnv(next)
  if (REQUIRED_SECRETS.some(key => updated[key] !== values[key])) fail('CONFIG_INVALID')
  return { text: next, values: updated, changed: next !== text }
}
export function assertNoOverrides(values, environment, development = {}) {
  for (const key of ['DATABASE_URL', 'EXPECTED_DATABASE_HOST', 'EXPECTED_DATABASE_NAME', ...REQUIRED_SECRETS]) {
    for (const source of [environment, development]) {
      if (Object.hasOwn(source, key) && source[key] !== values[key]) fail('ENV_OVERRIDE')
    }
  }
}
export function assertTarget(values) {
  const u = connectionURL(values.DATABASE_URL)
  if (values.EXPECTED_DATABASE_HOST && canonicalHost(u.hostname) !== canonicalHost(values.EXPECTED_DATABASE_HOST)) fail('TARGET_MISMATCH')
  if (values.EXPECTED_DATABASE_NAME && u.pathname !== `/${values.EXPECTED_DATABASE_NAME}`) fail('TARGET_MISMATCH')
  if (u.hostname.endsWith('.neon.tech') && (u.searchParams.get('sslmode') !== 'verify-full' || ['ssl', 'sslcert', 'sslkey', 'sslrootcert', 'uselibpqcompat'].some(k => u.searchParams.has(k)))) fail('SSL_UNSAFE')
}
export const ROLE_SQL = `
  SELECT current_database() AS database,
    rolsuper OR rolbypassrls OR rolcreaterole OR rolcreatedb AS excessive_privileges,
    has_schema_privilege(current_user, 'api', 'USAGE') AS api_usage,
    EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='private' AND c.relname='wallets' AND c.relkind IN ('r','p')) AS wallet_exists,
    EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='private' AND c.relkind IN ('r','p')
      AND has_table_privilege(current_user,c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')) AS private_table_access
  FROM pg_roles WHERE rolname=current_user`
export const CAPABILITY_SQL = `
  SELECT required.signature,
    COALESCE(has_function_privilege(current_user,p.oid,'EXECUTE'),false) AS executable
  FROM unnest($1::text[]) AS required(signature)
  LEFT JOIN pg_proc p ON p.oid=to_regprocedure(required.signature)`
export async function checkRuntime(client, values) {
  assertTarget(values)
  await client.query('BEGIN READ ONLY')
  try {
    await client.query("SET LOCAL statement_timeout = '8s'")
    const { rows: [role] } = await client.query(ROLE_SQL)
    if (!role || !role.wallet_exists || !role.api_usage || role.excessive_privileges || role.private_table_access) fail('RUNTIME_PRIVILEGES')
    if (values.EXPECTED_DATABASE_NAME && role.database !== values.EXPECTED_DATABASE_NAME) fail('TARGET_MISMATCH')
    const { rows } = await client.query(CAPABILITY_SQL, [REQUIRED_APIS])
    if (rows.length !== REQUIRED_APIS.length || rows.some(row => !row.executable)) fail('SCHEMA_CAPABILITIES')
    return { database: role.database, capabilities: rows.length }
  } finally { await client.query('ROLLBACK') }
}
