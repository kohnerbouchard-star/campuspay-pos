#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
  const full = path.join(dir, entry.name)
  return entry.isDirectory() ? walk(full) : [full]
})
const relative = (file) => path.relative(root, file).replaceAll('\\', '/')
const sourceFiles = walk(path.join(root, 'src')).filter((file) => /\.(ts|tsx)$/.test(file))
const clientFiles = sourceFiles.filter((file) => fs.readFileSync(file, 'utf8').trimStart().startsWith("'use client'"))
const routeFiles = sourceFiles.filter((file) => /\/app\/api\/.*\/route\.ts$/.test(`/${relative(file)}`))
const clientSource = clientFiles.map((file) => fs.readFileSync(file, 'utf8')).join('\n')
const allSource = sourceFiles.map((file) => fs.readFileSync(file, 'utf8')).join('\n')
const sqlFiles = walk(path.join(root, 'database', 'schema')).filter((file) => file.endsWith('.sql'))
const sql = sqlFiles.map((file) => fs.readFileSync(file, 'utf8')).join('\n')
const findings = []
const add = (passed, name, detail = '') => findings.push({ status: passed ? 'PASS' : 'FAIL', name, detail })

add(!/DATABASE_URL|HMAC_SECRET|PIN_PEPPER/.test(clientSource), 'No database URL or application secret referenced by client components')
add(!/@\/lib\/db\/client/.test(clientSource), 'Client components do not import the database client')
add(!routeFiles.some((file) => /(update[-_]?balance|set[-_]?balance|update[-_]?stock|set[-_]?stock)/i.test(relative(file))), 'No generic balance or stock mutation endpoint exists')
add(!/student[_-]?pin\s*[:=]\s*['"]\d{4,12}['"]|card[_-]?(?:uid|id)\s*[:=]\s*['"][0-9A-F]{6,}['"]/i.test(allSource), 'No hard-coded student PINs or raw card identifiers in source')
const largest = sourceFiles.map((file) => ({ file: relative(file), lines: fs.readFileSync(file, 'utf8').split(/\r?\n/).length })).sort((a, b) => b.lines - a.lines).slice(0, 10)
add((largest[0]?.lines ?? 0) < 350, 'Application modules remain bounded', `Largest: ${largest[0]?.file} (${largest[0]?.lines} lines)`)
add(/create role campuspay_runtime nologin noinherit/i.test(sql), 'Least-privilege runtime role is declared')
add(/revoke all on all tables in schema private from public, campuspay_runtime/i.test(sql), 'Private schema table access is revoked')
add(/revoke all on all functions in schema private from public, campuspay_runtime/i.test(sql), 'Private function execution is revoked')
add(/grant execute on all functions in schema api to campuspay_runtime/i.test(sql), 'Runtime role receives narrow API execution')
add(!/security definer(?![\s\S]{0,120}set search_path = '')/i.test(sql), 'Privileged database functions pin search_path')
add((sql.match(/idempotency_key/gi) ?? []).length >= 20, 'Idempotency control is represented in the transaction layer')
add((sql.match(/for update/gi) ?? []).length >= 8, 'Financial, inventory, and coupon operations use row locking')
add(/create table private\.coupons[\s\S]*?code_fingerprint\s+text/i.test(sql) && !/raw_coupon_code/i.test(sql), 'Coupon codes use HMAC fingerprints rather than raw-code columns')
add(/create table private\.coupon_redemptions/i.test(sql) && /per_student_limit/i.test(sql) && /total_redemption_limit/i.test(sql), 'Coupon redemption limits are represented')
add(!/@supabase|lib\/supabase|NEXT_PUBLIC_SUPABASE|SUPABASE_SECRET_KEY/.test(allSource), 'No Supabase runtime dependency remains')

const routeSummary = routeFiles.map(relative).sort()
fs.mkdirSync(path.join(root, '.validation'), { recursive: true })
fs.writeFileSync(path.join(root, '.validation', 'security-audit.json'), JSON.stringify({ findings, largest, routeSummary }, null, 2))
for (const finding of findings) console.log(`${finding.status}: ${finding.name}${finding.detail ? ` — ${finding.detail}` : ''}`)
if (findings.some((finding) => finding.status === 'FAIL')) process.exit(1)
