#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const srcRoot = path.join(root, 'src')
const extensions = ['.ts', '.tsx', '.js', '.jsx', '.json']

function walk(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const location = path.join(directory, entry.name)
    return entry.isDirectory() ? walk(location) : [location]
  })
}

function resolves(base) {
  if (fs.existsSync(base) && fs.statSync(base).isFile()) return true
  if (extensions.some((extension) => fs.existsSync(`${base}${extension}`))) return true
  return extensions.some((extension) => fs.existsSync(path.join(base, `index${extension}`)))
}

const failures = []
const files = walk(srcRoot).filter((file) => /\.(ts|tsx)$/.test(file))
const importPattern = /(?:from\s+|import\s*\()\s*['"]([^'"]+)['"]/g

for (const file of files) {
  const source = fs.readFileSync(file, 'utf8')
  for (const match of source.matchAll(importPattern)) {
    const specifier = match[1]
    if (!specifier.startsWith('@/') && !specifier.startsWith('./') && !specifier.startsWith('../')) continue
    const target = specifier.startsWith('@/')
      ? path.join(srcRoot, specifier.slice(2))
      : path.resolve(path.dirname(file), specifier)
    if (!resolves(target)) {
      failures.push({ file: path.relative(root, file), specifier })
    }
  }
}

fs.mkdirSync(path.join(root, '.validation'), { recursive: true })
fs.writeFileSync(
  path.join(root, '.validation', 'import-check.json'),
  JSON.stringify({ files: files.length, failures }, null, 2),
)

if (failures.length) {
  for (const failure of failures) console.error(`${failure.file}: unresolved import ${failure.specifier}`)
  process.exit(1)
}

console.log(`Local import check passed for ${files.length} TypeScript files.`)
