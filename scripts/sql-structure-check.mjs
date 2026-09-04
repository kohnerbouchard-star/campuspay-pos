import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const schemaDirectory = path.join(root, 'supabase', 'schema')
const files = fs.readdirSync(schemaDirectory).filter((name) => name.endsWith('.sql')).sort()
const modules = files.map((name) => ({ name, sql: fs.readFileSync(path.join(schemaDirectory, name), 'utf8') }))
const allSql = modules.map(({ sql }) => sql).join('\n')
const checks = []
const record = (name, passed, detail = '') => checks.push({ name, passed, detail })

record('Eight ordered schema modules are present', files.length === 8, files.join(', '))
record('Coupon module is applied after the base schema', files.at(-1) === '008_coupon_functions.sql', files.at(-1) ?? '')
record('Dollar-quote delimiters are paired', (allSql.match(/\$\$/g) ?? []).length % 2 === 0)

const declarations = [...allSql.matchAll(/create\s+(?:or\s+replace\s+)?(?:table|type)\s+([a-z_][a-z0-9_.]*)/gi)].map((match) => match[1].toLowerCase())
const duplicates = [...new Set(declarations.filter((name, index) => declarations.indexOf(name) !== index))]
record('Tables and enum types are declared once', duplicates.length === 0, duplicates.join(', '))

const securityDefinerBlocks = allSql.split(/create\s+or\s+replace\s+function/i).slice(1)
  .filter((block) => /security\s+definer/i.test(block))
const missingSearchPath = securityDefinerBlocks.filter((block) => {
  const header = block.split(/as\s+\$\$/i)[0] ?? block
  return !/set\s+search_path\s*=\s*''/i.test(header)
}).length
record('Every SECURITY DEFINER function pins search_path', missingSearchPath === 0, `${missingSearchPath} missing`)

const couponTable = allSql.match(/create\s+table\s+private\.coupons\s*\(([\s\S]*?)\n\);/i)?.[1] ?? ''
record('Coupon table exists', couponTable.length > 0)
record('Raw coupon codes are not stored', !/^\s*code\s+text/im.test(couponTable) && /code_fingerprint\s+text/i.test(couponTable))
record('Coupon code fingerprint is unique', /code_fingerprint\s+text\s+not\s+null\s+unique/i.test(couponTable))
record('Coupon use limits are modeled', /total_redemption_limit/i.test(couponTable) && /per_student_limit/i.test(couponTable))
record('Coupon redemptions have a dedicated ledger table', /create\s+table\s+private\.coupon_redemptions/i.test(allSql))
record('Final redemption locks the coupon row', /from\s+private\.coupons\s+where\s+id\s*=\s*v_intent\.coupon_id\s+for\s+update/i.test(allSql))
record('Checkout supports fully discounted sales without zero-value wallet entries', /if\s+v_intent\.total_won\s*>\s*0\s+then[\s\S]*?insert\s+into\s+private\.wallet_ledger/i.test(allSql))
record('Coupon APIs are revoked from public callers', /revoke\s+all\s+on\s+function\s+api\.create_coupon[\s\S]*?from\s+public,\s*anon/i.test(allSql))
record('Coupon APIs are granted only to authenticated callers', /grant\s+execute\s+on\s+function\s+api\.create_coupon[\s\S]*?to\s+authenticated/i.test(allSql))

const failed = checks.filter((check) => !check.passed)
fs.mkdirSync(path.join(root, '.validation'), { recursive: true })
fs.writeFileSync(path.join(root, '.validation', 'sql-structure-check.json'), JSON.stringify({ files, checks }, null, 2))
for (const check of checks) console.log(`${check.passed ? 'PASS' : 'FAIL'}: ${check.name}${check.detail ? ` — ${check.detail}` : ''}`)
if (failed.length) process.exit(1)
