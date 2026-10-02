// Owner-side read-only comparison with a fresh CI baseline. Never certifies by migration names alone.
import fs from 'node:fs'
import assert from 'node:assert/strict'
import pg from 'pg'
const query = `select n.nspname||'.'||p.proname||'('||pg_get_function_identity_arguments(p.oid)||')' identity,
 md5(pg_get_functiondef(p.oid)) fingerprint from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname in ('api','private') and p.prokind='f' order by 1`
const capture = process.argv.includes('--capture-ci')
const filename = process.argv.at(-1)
let client
try {
  const url = new URL(process.env.DATABASE_URL_UNPOOLED)
  if (capture) {
    assert.equal(process.env.CI, 'true')
    assert.ok(['localhost','127.0.0.1','[::1]'].includes(url.hostname))
  } else {
    assert.ok(process.env.EXPECTED_DATABASE_HOST && url.hostname === process.env.EXPECTED_DATABASE_HOST)
  }
  client = new pg.Client({ connectionString: url.href, connectionTimeoutMillis: 15000, query_timeout: 30000 })
  await client.connect()
  await client.query('begin read only')
  const rows = (await client.query(query)).rows
  await client.query('commit')
  if (capture) fs.writeFileSync(filename, JSON.stringify({ format: 1, functions: rows }, null, 2))
  else {
    const expected = JSON.parse(fs.readFileSync(filename, 'utf8'))
    assert.equal(expected.format, 1)
    const actual = new Map(rows.map(row => [row.identity, row.fingerprint]))
    const mismatches = expected.functions.filter(row => actual.get(row.identity) !== row.fingerprint).map(row => row.identity)
    const expectedNames = new Set(expected.functions.map(row => row.identity))
    mismatches.push(...rows.filter(row => !expectedNames.has(row.identity)).map(row => row.identity))
    console.log(JSON.stringify({ compared: expected.functions.length, mismatches }))
    assert.equal(mismatches.length, 0, 'INSTALLED_FUNCTION_DRIFT')
  }
} catch { console.error('Function verification failed. No connection values or function bodies were printed.'); process.exitCode = 1 }
finally { if (client) await client.end() }
