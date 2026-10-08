#!/usr/bin/env node
// Revised safety boundary: disposable localhost only; no journal deletion,
// trigger replacement, or fabricated direct financial rows in assertions.
import assert from 'node:assert/strict'
import { randomBytes, randomUUID } from 'node:crypto'
import fs from 'node:fs'
import pg from 'pg'
import { refundTestContext } from './refund-test-context.mjs'
import { share } from './refund-preview-math.mjs'
import { verifyPartialRaces } from './partial-refund-races.mjs'
import { verifyPartialBrowser } from './partial-refund-browser.mjs'
let ctx, phase = 'setup'
const checks = []
try {
  ctx = await refundTestContext()
  const { owner, request, login, pin } = ctx
  // The existing harness independently requires CI=true, a localhost target,
  // and creates a uniquely named disposable database before returning.
  const db = (await owner.query('select current_database() as name')).rows[0].name
  assert.match(db, /^campuspay_refund_[a-f0-9]{12}$/)
  await ctx.start(false)
  let admin = await login()
  const other = await login('9101'), cashier = await login('1001'), accountant = await login('3001')
  const water = (await request(admin, '/api/pos/catalog')).find(p => p.sku === 'WATER-001')
  const day = (await owner.query("select (now() at time zone 'Asia/Seoul')::date::text as business_date")).rows[0].business_date
  await request(admin, '/api/inventory/receipts', { supplierName: 'Isolated refund fixture', supplierInvoice: randomUUID(), purchaseDate: day, shippingWon: 0, otherCostsWon: 0, discountWon: 0, notes: 'Synthetic fixture inventory', idempotencyKey: randomUUID(), lines: [{ productId: water.id, quantity: 100, purchaseUnitCostWon: 500 }] }, 201)
  const card = 'PARTIAL' + randomBytes(12).toString('hex')
  await request(admin, '/api/students', { studentCode: 'QA-' + randomUUID().slice(0, 8), displayName: 'Synthetic refund customer', cardRead: card, pin, confirmationPin: pin, idempotencyKey: randomUUID() }, 201)
  const customer = new Map()
  await request(customer, '/api/store/login', { cardNumber: card, pin })
  const ids = () => ({ idempotencyKey: randomUUID(), reasonCode: 'OTHER', notes: 'Verified synthetic receipt, original lot and returned goods', verified: true })
  const snapshot = (d, offset = 0) => request(admin, '/api/refunds/items?reference=' + d.sale_id + '&offset=' + offset)
  const all = s => ({ saleId: s.sale.sale_id, ...ids(), expectedRefundCount: s.refund_count, items: s.allocations.filter(a => a.remaining_quantity > 0).map(a => ({ original_allocation_id: a.original_allocation_id, restock_quantity: a.remaining_quantity, write_off_quantity: 0 })) })
  const post = (v, who = admin, status = 200) => request(who, '/api/refunds/items', v, status)
  const quote = v => request(admin, '/api/refunds/items/quote', { saleId: v.saleId, items: v.items })
  const recover = v => request(admin, '/api/refunds/recover', { saleId: v.saleId, idempotencyKey: v.idempotencyKey })
  async function sale(mode = 'CASH', items = [{ productId: water.id, quantity: 3 }], couponCode) {
    if (mode !== 'WALLET') await request(admin, '/api/pos/payment-policy', { cashEnabled: true, eventName: 'Synthetic refund acceptance', endsAt: new Date(Date.now() + 3600000).toISOString() })
    const i = await request(admin, '/api/pos/intents', { items, tenderMode: mode, couponCode, idempotencyKey: randomUUID() }, 201)
    if (mode !== 'CASH') await request(admin, `/api/pos/intents/${i.intent_id}/card`, { cardRead: card })
    if (mode === 'SPLIT') await request(admin, `/api/pos/intents/${i.intent_id}/tender`, { walletAmountWon: 501 })
    const r = await request(admin, `/api/pos/intents/${i.intent_id}/confirm`, { ...(mode !== 'CASH' ? { pin } : {}), ...(mode !== 'WALLET' ? { cashReceivedWon: 100000 } : {}) })
    return request(admin, '/api/refunds/sale?reference=' + r.sale_id)
  }
  const footprint = async () => (await owner.query("select (select count(*) from private.sale_refunds) refunds,(select count(*) from private.wallet_ledger) entries,(select coalesce(sum(balance_won),0) from private.wallets) balances,(select coalesce(sum(quantity_remaining),0) from private.inventory_lots) stock")).rows[0]
  const roster = async () => (await owner.query("select (select count(*) from private.students) students,(select count(*) from private.student_cards) cards,(select count(*) from private.student_credentials) credentials")).rows[0]
  const rosterBefore = await roster(), first = await sale(), firstInput = all(await snapshot(first))
  phase = 'authorization and default-off gates'
  await post(firstInput, admin, 409)
  await ctx.start(true, { partialRefunds: true, returns: true, cash: true }); admin = await login('9001', admin)
  assert.equal((await post(firstInput)).outcome, 'DISABLED')
  // Fixture-only setup; never executed on the school database.
  await owner.query('update private.system_settings set refunds_enabled=true,returns_enabled=true,partial_refunds_enabled=true,cash_controls_enabled=true where singleton')
  const shift = await request(admin, '/api/cash/open', { requestKey: randomUUID(), counts: { '50000': 10 }, verified: true })
  await post(firstInput, new Map(), 401); await post(firstInput, cashier, 403); await post(firstInput, accountant, 403)
  await request(admin, '/api/refunds/items', firstInput, 403, 'https://untrusted.example')
  for (const extra of [{ verified: false }, { amountWon: 1 }, { items: [firstInput.items[0], firstInput.items[0]] }]) await post({ ...firstInput, ...extra }, admin, 400)
  checks.push('gates, origin, roles and strict input validation')
  phase = 'cumulative money and original tender allocation'
  await request(admin, '/api/coupons', { name: 'One-won fixture discount', code: 'PARTIALONE', discountType: 'FIXED', fixedAmountWon: 1, percentageBps: null, minimumSubtotalWon: 0, maxDiscountWon: null, totalRedemptionLimit: null, perStudentLimit: null, startsAt: new Date(Date.now() - 60000).toISOString(), endsAt: null, idempotencyKey: randomUUID() }, 201)
  for (const mode of ['WALLET', 'CASH', 'SPLIT']) {
    const d = await sale(mode, undefined, 'PARTIALONE'); let amount = 0, wallet = 0, cash = 0
    for (let n = 0; n < 3; n++) {
      const v = all(await snapshot(d)); v.items = [{ ...v.items[0], restock_quantity: n === 1 ? 0 : 1, write_off_quantity: n === 1 ? 1 : 0 }]
      const before = await footprint(), q = await quote(v)
      assert.equal(q.outcome, 'READY'); assert.deepEqual(await footprint(), before)
      const expected = Number(share(d.total_won, 3, n, 1))
      assert.equal(q.refund_won, expected); assert.equal(q.wallet_credit_won, Number(share(d.wallet_tender_won, d.total_won, amount, expected)))
      const r = await post(v); assert.equal(r.outcome, 'COMPLETED'); assert.equal(r.refund.scope, 'PARTIAL')
      assert.equal(r.refund.total_won, expected); assert.deepEqual(await post(v), r); assert.deepEqual(await recover(v), r)
      assert.equal((await post({ ...v, notes: 'Different request content must conflict' })).outcome, 'IDEMPOTENCY_CONFLICT')
      assert.equal((await post({ ...v, idempotencyKey: randomUUID() })).outcome, 'STALE_REFUND')
      if (r.refund.cash_due_won > 0) {
        const payout = { refundId: r.refund.refund_id, idempotencyKey: randomUUID(), amountWon: r.refund.cash_due_won, handoverReference: 'Synthetic physical cash receipt', confirmed: true }
        const paid = await request(admin, '/api/refunds/payout', payout)
        assert.equal(paid.refund.cash_paid_won, r.refund.cash_due_won); assert.deepEqual(await request(admin, '/api/refunds/payout', payout), paid)
      }
      amount += expected; wallet += r.refund.wallet_credit_won; cash += r.refund.cash_due_won
    }
    assert.equal(amount, d.total_won); assert.equal(wallet, d.wallet_tender_won); assert.equal(cash, d.cash_tender_won)
    const s = await snapshot(d); assert.equal(s.refund_count, 3); assert.ok(s.allocations.every(a => a.remaining_quantity === 0))
    assert.equal((await request(admin, '/api/refunds', { saleId: d.sale_id, ...ids(), items: d.items.map(i => ({ sale_item_id: i.sale_item_id, disposition: 'RESTOCK' })) })).outcome, 'PARTIAL_REFUND_EXISTS')
    const oldest = s.refunds.at(-1)
    assert.equal((await request(admin, '/api/refunds/record?refundId=' + oldest.refund_id)).refund_id, oldest.refund_id)
  }
  checks.push('repeated wallet/cash/split refunds, one-won rounding, original-tender payouts, replay and full/partial coexistence')
  phase = 'rejected commands and recovery fencing'
  const bad = all(await snapshot(first)), beforeBad = await footprint(); bad.items[0].restock_quantity = 999
  assert.equal((await post(bad)).outcome, 'INVALID_SELECTION'); assert.deepEqual(await footprint(), beforeBad)
  const safe = all(await snapshot(first))
  assert.equal((await recover(safe)).outcome, 'CLOSED'); assert.equal((await post(safe)).outcome, 'CLOSED')
  assert.equal((await post({ ...safe, idempotencyKey: randomUUID() })).outcome, 'COMPLETED')
  checks.push('over-quantity requests leave money/stock unchanged; recovery prevents delayed execution')
  phase = 'online returns and student isolation'
  const room = (await request(customer, '/api/store/locations')).find(r => r.room === '201')
  const order = await request(customer, '/api/store/orders', { items: [{ productId: water.id, quantity: 2 }], deliveryLocationId: room.location_id, idempotencyKey: randomUUID(), expectedTotalWon: 2400 }, 201)
  const online = await request(admin, '/api/refunds/sale?reference=' + order.order_number)
  const v = all(await snapshot(online)); v.returnReason = 'CUSTOMER_RETURN'; v.items[0].restock_quantity = 1
  assert.equal((await post(v)).outcome, 'RETURN_INELIGIBLE')
  for (const status of ['PICKING', 'READY', 'OUT_FOR_DELIVERY', 'DELIVERED']) await request(cashier, `/api/orders/${order.order_id}/status`, { status })
  assert.equal((await post(v)).outcome, 'COMPLETED'); assert.equal((await snapshot(online)).sale.order_status, 'DELIVERED')
  const history = await request(customer, `/api/store/orders/${order.order_id}/refunds`)
  assert.equal(history.refunded_won, 1200)
  for (const key of ['operator_id', 'terminal_id', 'notes', 'inventory_lot_id', 'cogs', 'student_id']) assert.ok(!JSON.stringify(history).includes(key))
  await request(admin, `/api/store/orders/${order.order_id}/refunds`, undefined, 401)
  const remaining = all(await snapshot(online)); remaining.returnReason = 'CUSTOMER_RETURN'
  assert.equal((await post(remaining)).outcome, 'COMPLETED'); assert.equal((await snapshot(online)).sale.order_status, 'RETURNED')
  checks.push('partial return preserves delivery state; final return closes the order; customer projection excludes staff data')
  phase = 'read-only integrity and access checks'
  const runtime = new pg.Client({ connectionString: ctx.runtimeUrl }); await runtime.connect()
  try { await assert.rejects(() => runtime.query('select * from private.partial_refund_items'), e => e.code === '42501') } finally { await runtime.end() }
  const guards = (await owner.query("select c.relname,t.tgname,t.tgenabled,t.tgdeferrable,t.tginitdeferred from pg_catalog.pg_trigger t join pg_catalog.pg_class c on c.oid=t.tgrelid join pg_catalog.pg_namespace n on n.oid=c.relnamespace where n.nspname='private' and not t.tgisinternal and c.relname in ('partial_refund_contexts','partial_refund_items','sale_refunds','refund_tenders','refund_allocations')")).rows
  for (const table of ['partial_refund_contexts', 'partial_refund_items']) {
    assert.ok(guards.some(t => t.relname === table && t.tgname === 'immutable_journal' && t.tgenabled === 'O'))
    assert.ok(guards.some(t => t.relname === table && t.tgname === 'refund_reconciliation' && t.tgdeferrable && t.tginitdeferred && t.tgenabled === 'O'))
  }
  for (const table of ['sale_refunds', 'refund_tenders', 'refund_allocations']) assert.ok(guards.some(t => t.relname === table && t.tgname === 'cumulative_reconciliation' && t.tgdeferrable && t.tginitdeferred && t.tgenabled === 'O'))
  assert.equal((await owner.query('select s.id from private.sales s join private.sale_refunds r on r.sale_id=s.id group by s.id,s.total_won having sum(r.total_won)>s.total_won')).rows.length, 0)
  checks.push('private-table isolation and enabled immutable/deferred guards; no fabricated journal mutations')
  phase = 'concurrent commands and browser workflow'
  const races = await verifyPartialRaces(ctx, admin, other, sale, all)
  const browser = await verifyPartialBrowser(ctx, admin, await sale())
  checks.push('independent-connection overlap, real browser posting and lost-response recovery')
  phase = 'financial reconciliation'
  const summary = await request(admin, `/api/refunds/summary?from=${day}&to=${day}`)
  const totals = (await owner.query('select count(*) n,coalesce(sum(total_won),0) total from private.sale_refunds')).rows[0]
  assert.equal(summary.refund_count, Number(totals.n)); assert.equal(summary.refunds_won, Number(totals.total))
  const cash = await request(admin, '/api/cash')
  const events = (await owner.query('select coalesce(sum(amount_won),0) total from private.cash_shift_events where shift_id=$1', [shift.shift_id])).rows[0].total
  assert.equal(cash.current_shift.expected_won, 500000 + Number(events)); assert.deepEqual(await roster(), rosterBefore)
  fs.mkdirSync('.validation/partial-refunds', { recursive: true })
  fs.writeFileSync('.validation/partial-refunds/results.json', JSON.stringify({ checks, races, browser, liveDataUsed: false, postingImplemented: true, destructiveTestMutations: false }, null, 2))
  console.log(`Partial refunds passed: ${checks.length} acceptance groups and ${races.length} controlled overlaps.`)
} catch (e) {
  fs.mkdirSync('.validation/partial-refunds', { recursive: true })
  fs.writeFileSync('.validation/partial-refunds/failure.txt', `Phase: ${phase}\n${e?.stack ?? 'unknown'}`)
  console.error(`Partial refund acceptance failed at ${phase}: ${e?.message ?? 'unknown'}`); process.exitCode = 1
} finally { if (ctx) await ctx.close() }
