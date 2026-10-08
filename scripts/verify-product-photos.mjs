// Production components/API + real disposable PostgreSQL; never a hosted target.
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import { randomBytes, randomUUID } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { photoContext, photoReason } from './product-photo-context.mjs'
import { verifyPhotoDatabase, verifyPhotoMigration } from './product-photo-database.mjs'
import { verifyPhotoBrowser } from './product-photo-browser.mjs'
const directory = '.validation/product-photos', checks = [], evidence = []
let ctx, phase = 'setup'
const report = { commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), tree: execFileSync('git', ['rev-parse', 'HEAD^{tree}'], { encoding: 'utf8' }).trim(), checks, evidence }
await fs.mkdir(directory, { recursive: true })
try {
  ctx = await photoContext(); await ctx.start(false)
  const admin = await ctx.login(), catalog = await ctx.request(admin, '/api/pos/catalog'), product = catalog.find(p => p.sku === 'WATER-001'), other = catalog.find(p => p.id !== product?.id)
  assert.ok(product && other)
  const cardNumber = `PHOTO${randomBytes(12).toString('hex')}`
  await ctx.request(admin, '/api/students', { studentCode: `PHOTO-${randomUUID().slice(0, 8)}`, displayName: 'Synthetic product-photo catalog customer', cardRead: cardNumber, pin: ctx.pin, confirmationPin: ctx.pin, idempotencyKey: randomUUID() }, 201)
  const customer = new Map(); await ctx.request(customer, '/api/store/login', { cardNumber, pin: ctx.pin })
  // Snapshot AFTER synthetic authentication fixtures exist. Photo flows must not change them.
  const before = await ctx.financialSnapshot(); report.before = before
  await ctx.http(customer, product.id, 'DELETE', { requestId: randomUUID(), revision: 0, reason: photoReason }, 401)
  phase = 'migration and least privilege'; await verifyPhotoMigration(ctx, checks)
  phase = 'native API and failure transitions'; await verifyPhotoDatabase(ctx, admin, product, other, checks)
  phase = 'actual desktop and mobile browsers'; report.browser = await verifyPhotoBrowser(ctx, admin, customer, product, checks, evidence)
  phase = 'protected financial invariants'; const after = await ctx.financialSnapshot(); report.after = after; assert.deepEqual(after, before)
  checks.push('Product rows, inventory, stock receipts, wallets, wallet ledger, sales and sale-item snapshots are byte-equivalent before/after all photo journeys')
  await ctx.close(); ctx = null
  phase = 'missing storage configuration'; ctx = await photoContext(false); await ctx.start(false)
  const unconfiguredAdmin = await ctx.login(), unconfiguredProducts = await ctx.request(unconfiguredAdmin, '/api/pos/catalog')
  assert.ok(unconfiguredProducts.length > 0); assert.ok(unconfiguredProducts.every(row => !row.photo))
  await ctx.http(unconfiguredAdmin, unconfiguredProducts[0].id, 'GET', undefined, 503)
  await ctx.http(unconfiguredAdmin, unconfiguredProducts[0].id, 'DELETE', { requestId: randomUUID(), revision: 0, reason: photoReason }, 503)
  assert.equal((await ctx.owner.query('select count(*) n from private.product_photo_operations')).rows[0].n, '0')
  checks.push('Missing storage credentials fail closed for photo operations while the existing catalog remains usable without photos')
  report.result = 'PASS'; await fs.writeFile(`${directory}/results.json`, JSON.stringify(report, null, 2)); console.log(JSON.stringify(report, null, 2))
} catch (error) {
  report.result = 'FAIL'; report.phase = phase; report.error = error instanceof Error ? error.stack : String(error)
  await fs.writeFile(`${directory}/results.json`, JSON.stringify(report, null, 2)); console.error(JSON.stringify(report, null, 2)); process.exitCode = 1
} finally { if (ctx) await ctx.close() }
