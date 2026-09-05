#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
const root = path.resolve(import.meta.dirname, '..')
const schema = path.join(root, 'database/schema')
const names = fs.readdirSync(schema).filter((n) => /^00[1-9]_.*\.sql$/.test(n)).sort()
const text = names.map((n) => `-- BEGIN ${n}\n${fs.readFileSync(path.join(schema,n),'utf8').trim()}\n-- END ${n}`).join('\n\n')
// Review-only bootstrap; existing migrations are immutable.
fs.writeFileSync(path.join(root,'database/bootstrap.sql'), text + '\n')
console.log('Generated database/bootstrap.sql for review only; deploy versioned migrations.')
