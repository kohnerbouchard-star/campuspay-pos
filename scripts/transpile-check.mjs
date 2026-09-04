import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
let ts
try {
  ts = require('typescript')
} catch {
  ts = require('/opt/nvm/versions/node/v22.16.0/lib/node_modules/typescript/lib/typescript.js')
}

const root = process.cwd()
const walk = (directory) => fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
  const filePath = path.join(directory, entry.name)
  return entry.isDirectory() ? walk(filePath) : [filePath]
})
const files = walk(path.join(root, 'src')).filter((filePath) => /\.(ts|tsx)$/.test(filePath))
const failures = []

for (const filePath of files) {
  const source = fs.readFileSync(filePath, 'utf8')
  const result = ts.transpileModule(source, {
    fileName: filePath,
    reportDiagnostics: true,
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      jsx: ts.JsxEmit.Preserve,
      isolatedModules: true,
    },
  })
  for (const diagnostic of result.diagnostics ?? []) {
    if (diagnostic.category !== ts.DiagnosticCategory.Error) continue
    const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')
    const location = diagnostic.file && diagnostic.start !== undefined
      ? diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start)
      : null
    failures.push({
      file: path.relative(root, filePath),
      line: location ? location.line + 1 : null,
      column: location ? location.character + 1 : null,
      code: diagnostic.code,
      message,
    })
  }
}

fs.mkdirSync(path.join(root, '.validation'), { recursive: true })
fs.writeFileSync(path.join(root, '.validation', 'transpile-check.json'), JSON.stringify({ files: files.length, failures }, null, 2))
if (failures.length) {
  for (const failure of failures) console.error(`${failure.file}:${failure.line ?? '?'}:${failure.column ?? '?'} TS${failure.code} ${failure.message}`)
  process.exit(1)
}
console.log(`Syntactic TypeScript/TSX check passed for ${files.length} files.`)
