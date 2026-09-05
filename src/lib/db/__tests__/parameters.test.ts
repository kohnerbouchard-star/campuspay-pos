import { describe, expect, it } from 'vitest'
import { sql } from 'drizzle-orm'
import { PgDialect } from 'drizzle-orm/pg-core'

const dialect = new PgDialect()

describe('PostgreSQL RPC value parameters', () => {
  it('binds wallet denominations as one array parameter', () => {
    const query = dialect.sqlToQuery(sql`select ${sql.param([1000, 5000, 20000])}::integer[]`)
    expect(query.sql).toBe('select $1::integer[]')
    expect(query.params).toEqual([[1000, 5000, 20000]])
  })
  it('keeps supplied text out of the SQL string', () => {
    const value = "x'); SELECT pg_sleep(10); --"
    const query = dialect.sqlToQuery(sql`select ${sql.param(value)}::text`)
    expect(query.sql).toBe('select $1::text')
    expect(query.params).toEqual([value])
  })
})
