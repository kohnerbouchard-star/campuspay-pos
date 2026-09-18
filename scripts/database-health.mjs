#!/usr/bin/env node
import pg from 'pg'
import { assertTarget, checkRuntime, safeFailure } from './lib/local-readiness.mjs'

let client
try {
  assertTarget(process.env)
  client = new pg.Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 15_000, query_timeout: 10_000 })
  await client.connect()
  const result = await checkRuntime(client, process.env)
  console.log(`Database connected; restricted runtime role and ${result.capabilities} required API capabilities verified.`)
  console.log('Read-only capability check; not an exact migration-history or purchase-flow certification.')
} catch (error) {
  console.error(`Database check failed. ${safeFailure(error)}`)
  process.exitCode = 1
} finally {
  if (client) {
    try { await client.end() } catch { console.error('Database connection cleanup failed. No credentials were printed.'); process.exitCode = 1 }
  }
}
