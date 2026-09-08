import 'server-only'
import { Pool } from 'pg'
import { drizzle } from 'drizzle-orm/node-postgres'
import { getServerEnv } from '@/lib/env/server'
import { logPoolFailure } from '@/lib/api/request-context'

const globals = globalThis as typeof globalThis & { campusPayPool?: Pool }
/** Server-only pool. DATABASE_URL must use the restricted runtime login. */
export function database() {
  const pool = globals.campusPayPool ?? new Pool({
    connectionString: getServerEnv().DATABASE_URL,
    max: 5,
    connectionTimeoutMillis: 15_000,
    idleTimeoutMillis: 30_000,
    application_name: 'campuspay',
  })
  if (!globals.campusPayPool) {
    pool.on('error', logPoolFailure)
    globals.campusPayPool = pool
  }
  return drizzle(pool)
}
