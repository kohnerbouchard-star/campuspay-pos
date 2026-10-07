// Test-only alias resolver for Node's built-in type stripping. No app loader changes.
import { fileURLToPath, pathToFileURL } from 'node:url'
import { existsSync } from 'node:fs'
const source = new URL('../src/', import.meta.url)
export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith('@/')) {
    const base = new URL(specifier.slice(2), source)
    for (const extension of ['.ts', '.tsx', '/index.ts']) {
      const path = fileURLToPath(base) + extension
      if (existsSync(path)) return nextResolve(pathToFileURL(path).href, context)
    }
  }
  return nextResolve(specifier, context)
}
