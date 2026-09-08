#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const schemaDirectory = path.join(root, 'database', 'schema')
const files = fs.readdirSync(schemaDirectory).filter((name) => /^\d{3}_.*\.sql$/.test(name)).sort()
const allSql = files.map((name) => fs.readFileSync(path.join(schemaDirectory, name), 'utf8')).join('\n')
const checks = []
const record = (name, passed, detail = '') => checks.push({ name, passed, detail })

record('Ordered schema modules are present', files.length >= 16 && files.slice(0, 16).every((file, i) => file.startsWith(String(i + 1).padStart(3, '0') + '_')), files.join(', '))
record('Runtime hardening precedes the one-time bootstrap module', files.indexOf('009_runtime_hardening.sql') < files.indexOf('010_demo_bootstrap.sql') && files.includes('012_online_store.sql'), '010_demo_bootstrap.sql before 012_online_store.sql', files.at(-1) ?? '')
record('Dollar-quote delimiters are paired', (allSql.match(/\$\$/g) ?? []).length % 2 === 0)
record('No Supabase Auth dependency remains', !/auth\.uid\(\)|auth\.users|\b(?:to|from|role)\s+(?:anon|authenticated)\b/i.test(allSql))
record('Staff PINs use an HMAC proof plus slow database hash', /p_pin_proof[\s\S]*extensions\.crypt/i.test(allSql))
record('Staff sessions have bounded sliding and absolute expiry', /select interval '15 minutes'/.test(fs.readFileSync(path.join(schemaDirectory, '020_auth_session_hardening.sql'), 'utf8')) && /created_at \+ interval '8 hours'/.test(allSql))
record('Wallet floor remains negative fifteen thousand won', /negative_wallet_limit_won[\s\S]*-15000/i.test(allSql))
record('FIFO and LIFO lot allocation remain available', /inventory_cost_method[\s\S]*FIFO[\s\S]*LIFO/i.test(allSql))
record('Runtime role has no direct private-table access', /revoke all on all tables in schema private from public, campuspay_runtime/i.test(allSql))
record('Runtime role receives API execution only', /grant execute on all functions in schema api to campuspay_runtime/i.test(allSql))
record('Every SECURITY DEFINER function pins search_path', !/security definer(?![\s\S]{0,120}set search_path = '')/i.test(allSql))
record('Coupon fingerprints and redemption limits remain modeled', /code_fingerprint[\s\S]*total_redemption_limit[\s\S]*per_student_limit/i.test(allSql))
record('Financial and inventory operations retain row locks', (allSql.match(/for update/gi) ?? []).length >= 8)
record('Idempotency controls remain represented', (allSql.match(/idempotency_key/gi) ?? []).length >= 25)
record('Online store uses isolated customer sessions', /create table private\.customer_sessions[\s\S]*campuspay_customer_session|create table private\.customer_sessions/i.test(allSql))
record('Online orders share wallet and inventory transaction locks', /create_online_order[\s\S]*private\.wallets[\s\S]*for update[\s\S]*private\.inventory_lots/i.test(allSql))
record('Delivery directory contains East and West buildings', /East Building[\s\S]*West Building|West Building[\s\S]*East Building/i.test(allSql))

record('Sale tenders reconcile at commit', /constraint trigger sale_tender_reconciliation[\s\S]*deferrable initially deferred/i.test(allSql))
record('Enrollment is a narrow authorized operation', /api\.enroll_student[\s\S]*students.manage/i.test(allSql))
record('Store catalog requires customer authorization', /api\.store_catalog\(p_customer_session_id uuid\)[\s\S]*assert_customer_session/i.test(allSql))

const failures = checks.filter((check) => !check.passed)
for (const check of checks) {
  console.log(`${check.passed ? 'PASS' : 'FAIL'}: ${check.name}${check.detail ? ` — ${check.detail}` : ''}`)
}
fs.mkdirSync(path.join(root, '.validation'), { recursive: true })
fs.writeFileSync(path.join(root, '.validation', 'sql-structure-check.json'), JSON.stringify({ files, checks }, null, 2))
if (failures.length) process.exit(1)
