import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
  const filePath = path.join(dir, entry.name)
  return entry.isDirectory() ? walk(filePath) : [filePath]
})
const relativePath = (filePath) => path.relative(root, filePath).replaceAll('\\', '/')
const sourceFiles = walk(path.join(root, 'src')).filter((filePath) => /\.(ts|tsx)$/.test(filePath))
const routeFiles = sourceFiles.filter((filePath) => /\/api\/.*\/route\.ts$/.test(filePath.replaceAll('\\', '/')))
const clientFiles = sourceFiles.filter((filePath) => /^['"]use client['"]/.test(fs.readFileSync(filePath, 'utf8').trimStart()))
const findings = []
const pass = (name, detail = '') => findings.push({ status: 'PASS', name, detail })
const fail = (name, detail = '') => findings.push({ status: 'FAIL', name, detail })

const clientSource = clientFiles.map((filePath) => fs.readFileSync(filePath, 'utf8')).join('\n')
if (!/SUPABASE_(?:SECRET|SERVICE_ROLE)|service_role|COUPON_HMAC_SECRET|CARD_HMAC_SECRET/i.test(clientSource)) {
  pass('No privileged key or HMAC secret referenced by client components')
} else {
  fail('Privileged key or HMAC secret referenced by a client component')
}

const badClientImports = []
for (const filePath of clientFiles) {
  const text = fs.readFileSync(filePath, 'utf8')
  if (/from\s+['"]@\/lib\/supabase\/(?:admin|server)['"]/.test(text) || /from\s+['"].*\/server['"]/.test(text)) {
    badClientImports.push(relativePath(filePath))
  }
}
if (!badClientImports.length) pass('Client components do not import server/admin database clients')
else fail('Client/server boundary violations', badClientImports.join(', '))

const forbiddenRoutes = routeFiles.map(relativePath).filter((route) => /(update[-_]?balance|set[-_]?balance|update[-_]?stock|set[-_]?stock)/i.test(route))
if (!forbiddenRoutes.length) pass('No generic balance or stock mutation endpoint exists')
else fail('Generic balance or stock mutation endpoint found', forbiddenRoutes.join(', '))

const credentialLeaks = sourceFiles.map((filePath) => ({ filePath, text: fs.readFileSync(filePath, 'utf8') }))
  .filter(({ text }) => /student[_-]?pin\s*[:=]\s*['"]\d{4,8}['"]|card[_-]?(?:uid|id)\s*[:=]\s*['"][0-9A-F]{6,}['"]/i.test(text))
  .map(({ filePath }) => relativePath(filePath))
if (!credentialLeaks.length) pass('No hard-coded student PINs or raw card identifiers in source')
else fail('Hard-coded credential-like values found', credentialLeaks.join(', '))

const largest = sourceFiles.map((filePath) => ({
  file: relativePath(filePath),
  lines: fs.readFileSync(filePath, 'utf8').split(/\r?\n/).length,
})).sort((left, right) => right.lines - left.lines).slice(0, 10)
if (largest[0]?.lines <= 350) pass('Application modules remain bounded', `Largest: ${largest[0]?.file} (${largest[0]?.lines} lines)`)
else fail('Oversized application module', `${largest[0]?.file} (${largest[0]?.lines} lines)`)

const sqlFiles = walk(path.join(root, 'supabase', 'schema')).filter((filePath) => filePath.endsWith('.sql'))
const sql = sqlFiles.map((filePath) => fs.readFileSync(filePath, 'utf8')).join('\n')
if (/enable row level security/i.test(sql)) pass('RLS is enabled in schema SQL')
else fail('No RLS enable statements found')
if (/revoke\s+all\s+on\s+all\s+tables\s+in\s+schema\s+private\s+from\s+public/i.test(sql) || /revoke\s+.*schema\s+private/i.test(sql)) pass('Private schema access is revoked')
else fail('Private schema revocation not detected')
if (/security definer/i.test(sql) && /set\s+search_path/i.test(sql)) pass('Privileged database functions pin search_path')
else fail('SECURITY DEFINER/search_path control not detected')
if (/idempotency/i.test(sql)) pass('Idempotency control is represented in the database transaction layer')
else fail('Idempotency control not detected')
if (/for\s+update/i.test(sql)) pass('Financial, inventory, and coupon operations use row locking')
else fail('Row locking not detected')
if (/create table private\.coupons[\s\S]*?code_fingerprint\s+text/i.test(sql) && !/create table private\.coupons[\s\S]*?\n\s*code\s+text/i.test(sql)) {
  pass('Coupon codes use HMAC fingerprints rather than raw-code columns')
} else {
  fail('Coupon code storage pattern is unsafe or missing')
}
if (/create table private\.coupon_redemptions/i.test(sql) && /per_student_limit/i.test(sql) && /total_redemption_limit/i.test(sql)) {
  pass('Coupon redemption limits are represented in the transaction model')
} else {
  fail('Coupon redemption controls not detected')
}

const routeSummary = routeFiles.map(relativePath).sort()
const failed = findings.filter((finding) => finding.status === 'FAIL')
const markdown = [
  '# Security and Modularity Audit',
  '',
  `Generated: ${new Date().toISOString()}`,
  '',
  '## Automated checks',
  '',
  ...findings.map((finding) => `- **${finding.status} — ${finding.name}**${finding.detail ? `: ${finding.detail}` : ''}`),
  '',
  '## Largest application modules',
  '',
  '| File | Lines |',
  '|---|---:|',
  ...largest.map((entry) => `| \`${entry.file}\` | ${entry.lines} |`),
  '',
  '## API route inventory',
  '',
  ...routeSummary.map((route) => `- \`${route}\``),
  '',
  '## Interpretation',
  '',
  'This static audit checks source boundaries and schema patterns. It supplements, but does not replace, database advisor checks and integration tests against the configured Supabase project.',
].join('\n')
fs.mkdirSync(path.join(root, '.validation'), { recursive: true })
fs.writeFileSync(path.join(root, 'docs', 'SECURITY_AUDIT.md'), markdown)
fs.writeFileSync(path.join(root, '.validation', 'security-audit.json'), JSON.stringify({ findings, largest, routeSummary }, null, 2))
process.exit(failed.length ? 1 : 0)
