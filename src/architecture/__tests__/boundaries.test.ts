import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const root = process.cwd()
function filesUnder(directory: string): string[] {
  const result: string[] = []
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry)
    if (statSync(path).isDirectory()) result.push(...filesUnder(path))
    else result.push(path)
  }
  return result
}

describe('module boundaries', () => {
  it('never imports the database client into a client component', () => {
    const source = filesUnder(join(root, 'src')).filter((file) => /\.(ts|tsx)$/.test(file))
    const violations = source.filter((file) => {
      const text = readFileSync(file, 'utf8')
      return text.startsWith("'use client'") && text.includes("@/lib/db/client")
    }).map((file) => relative(root, file))
    expect(violations).toEqual([])
  })

  it('does not expose generic balance or stock update routes', () => {
    const routes = filesUnder(join(root, 'src/app/api')).map((file) => relative(root, file))
    expect(routes.some((route) => /update-(balance|stock)/i.test(route))).toBe(false)
  })

  it('keeps route handlers thin', () => {
    const routes = filesUnder(join(root, 'src/app/api')).filter((file) => file.endsWith('route.ts'))
    const oversized = routes.filter((file) => readFileSync(file, 'utf8').split('\n').length > 45)
      .map((file) => relative(root, file))
    expect(oversized).toEqual([])
  })
})
