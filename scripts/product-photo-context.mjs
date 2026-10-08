// Photo-only synthetic harness. Uses the established disposable localhost DB lifecycle.
import assert from 'node:assert/strict'
import { randomBytes, randomUUID, createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'
import { refundTestContext } from './refund-test-context.mjs'

export const photoOrigin = 'https://synthetic.public.blob.vercel-storage.com'
export const photoNamespace = 'test/synthetic-products'
export const photoReason = 'Synthetic product photo acceptance check'
export async function photoContext(configured = true) {
  assert.equal(process.env.CI, 'true')
  assert.equal(process.env.CAMPUSPAY_LOCAL_HTTP, 'true')
  const directory = `/tmp/campuspay-photos-${randomBytes(12).toString('hex')}`
  await fs.mkdir(directory, { mode: 0o700 })
  const overrides = { PRODUCT_PHOTOS_ENABLED: 'true', PRODUCT_PHOTOS_PUBLIC_ACCESS: 'acknowledged', PRODUCT_PHOTOS_ENVIRONMENT: 'test', PRODUCT_PHOTOS_NAMESPACE: 'synthetic-products', PRODUCT_PHOTOS_BLOB_PUBLIC_ORIGIN: photoOrigin, PRODUCT_PHOTOS_LOCAL_TEST_STORE: configured ? directory : undefined, PRODUCT_PHOTOS_BLOB_READ_WRITE_TOKEN: undefined, VERCEL: undefined, VERCEL_ENV: undefined, VERCEL_BLOB_API_URL: undefined, NEXT_PUBLIC_VERCEL_BLOB_API_URL: undefined }
  const before = Object.fromEntries(Object.keys(overrides).map(key => [key, process.env[key]]))
  let ctx
  try {
    for (const [key, value] of Object.entries(overrides)) { if (value === undefined) delete process.env[key]; else process.env[key] = value }
    ctx = await refundTestContext()
  } finally { for (const [key, value] of Object.entries(before)) { if (value === undefined) delete process.env[key]; else process.env[key] = value } }
  assert.match((await ctx.owner.query('select current_database() name')).rows[0].name, /^campuspay_refund_[a-f0-9]{12}$/)
  const cookie = cookies => [...cookies].map(([key, value]) => `${key}=${value}`).join('; ')
  async function http(cookies, product, method = 'GET', payload, expected = 200, suffix = '', origin = ctx.base) {
    const route = product ? `/api/inventory/products/${product}/photo${suffix}` : '/api/inventory/product-photos/cleanup'
    const response = await fetch(ctx.base + route, { method, headers: { cookie: cookie(cookies), origin, 'Content-Type': 'application/json' }, body: payload === undefined ? undefined : JSON.stringify(payload), signal: AbortSignal.timeout(25000) })
    const envelope = await response.json()
    assert.equal(response.status, expected, `${method} ${route}: ${JSON.stringify(envelope)}`)
    assert.equal(envelope.ok, expected < 400)
    return envelope.ok ? envelope.data : envelope.error
  }
  async function upload(cookies, product, bytes, revision, requestId = randomUUID(), expected = 200, crop = { mode: 'fit', x: 50, y: 50 }) {
    const response = await fetch(`${ctx.base}/api/inventory/products/${product}/photo`, { method: 'POST', headers: { cookie: cookie(cookies), origin: ctx.base, 'Content-Type': 'application/octet-stream', 'X-Photo-Metadata': encodeURIComponent(JSON.stringify({ requestId, revision, reason: photoReason, crop })) }, body: bytes, signal: AbortSignal.timeout(55000) })
    const envelope = await response.json(); assert.equal(response.status, expected, `Upload: ${JSON.stringify(envelope)}`); assert.equal(envelope.ok, expected < 400)
    return { requestId, data: envelope.ok ? envelope.data : envelope.error }
  }
  const read = (cookies, product, id) => http(cookies, product, 'GET', undefined, 200, id ? `?requestId=${id}` : '')
  const commit = (cookies, product, requestId, expected = 200) => http(cookies, product, 'PUT', { requestId }, expected)
  const cancel = (cookies, product, requestId) => http(cookies, product, 'POST', { requestId }, 200, '/cancel')
  const rateReset = () => ctx.owner.query('delete from private.product_photo_rate_limits')
  const fileFor = url => { const u = new URL(url); assert.equal(u.origin, photoOrigin); assert.match(u.pathname, /^\/campuspay-products\/test\/synthetic-products\/[a-f0-9-]{36}\/[a-f0-9-]{36}\/(display|thumbnail)\.webp$/); return path.join(directory, u.pathname) }
  async function image(format = 'png', background = '#2d6384') { return sharp({ create: { width: 640, height: 320, channels: 3, background } }).toFormat(format).toBuffer() }
  const protectedTables = ['public.products', 'private.product_price_history', 'private.stock_receipt_lines', 'private.inventory_lots', 'private.inventory_movements', 'private.stock_receipts', 'private.sales', 'private.sale_items', 'private.wallets', 'private.wallet_ledger']
  async function financialSnapshot() {
    const result = {}
    for (const table of protectedTables) {
      const rows = (await ctx.owner.query(`select to_jsonb(t)::text row from ${table} t order by to_jsonb(t)::text`)).rows
      result[table] = { count: rows.length, sha256: createHash('sha256').update(JSON.stringify(rows)).digest('hex') }
    }
    return result
  }
  return { ...ctx, directory, cookie, http, upload, read, commit, cancel, rateReset, fileFor, image, financialSnapshot,
    close: async () => { try { await ctx.close() } finally { await fs.rm(directory, { recursive: true, force: true }) } } }
}
