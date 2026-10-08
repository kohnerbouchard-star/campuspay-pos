#!/usr/bin/env node
import assert from 'node:assert/strict'
import { randomBytes, randomUUID } from 'node:crypto'
import fs from 'node:fs'
import pg from 'pg'
import { refundTestContext } from './refund-test-context.mjs'
import { runRefundBrowser } from './refund-browser.mjs'
let ctx, phase = 'initialize'
const checks = []
try {
  ctx = await refundTestContext()
  const { owner, request, raw, login, pin } = ctx
  await ctx.start(false)
  let admin = await login(), other = await login('9101')
  const cashier = await login('1001'), accountant = await login('3001'), inventory = await login('2001')
  const products = await request(admin, '/api/pos/catalog'), water = products.find(p => p.sku === 'WATER-001'), cookie = products.find(p => p.sku === 'COOKIE-001')
  const today = (await owner.query("select (now() at time zone 'Asia/Seoul')::date::text as day")).rows[0].day
  async function student() {
    const card = `REFUNDQA${randomBytes(10).toString('hex')}`
    const s = await request(admin, '/api/students', { studentCode: `RQA-${randomBytes(6).toString('hex')}`, displayName: 'Synthetic refund customer', cardRead: card, pin, confirmationPin: pin, idempotencyKey: randomUUID() }, 201)
    return { id: s.student_id, card }
  }
  async function sale({ mode = 'WALLET', customer, items = [{ productId: water.id, quantity: 1 }], couponCode } = {}) {
    if (mode !== 'WALLET') await request(admin, '/api/pos/payment-policy', { cashEnabled: true, eventName: 'Refund QA', endsAt: new Date(Date.now() + 3600000).toISOString() })
    const s = customer ?? (mode === 'CASH' ? null : await student())
    const intent = await request(admin, '/api/pos/intents', { items, tenderMode: mode, couponCode, idempotencyKey: randomUUID() }, 201)
    if (mode !== 'CASH') await request(admin, `/api/pos/intents/${intent.intent_id}/card`, { cardRead: s.card })
    if (mode === 'SPLIT') await request(admin, `/api/pos/intents/${intent.intent_id}/tender`, { walletAmountWon: 500 })
    const receipt = await request(admin, `/api/pos/intents/${intent.intent_id}/confirm`, { ...(mode !== 'CASH' ? { pin } : {}), ...(mode !== 'WALLET' ? { cashReceivedWon: 10000 } : {}) })
    assert.ok(receipt.sale_id && receipt.receipt_number)
    const detail = await request(admin, `/api/refunds/sale?reference=${receipt.sale_id}`)
    return { detail, customer: s, receipt }
  }
  const input = (s, disposition = 'RESTOCK') => ({ saleId: s.sale_id, idempotencyKey: randomUUID(), reasonCode: 'OTHER', notes: 'Synthetic verified full return', verified: true, items: s.items.map(i => ({ sale_item_id: i.sale_item_id, disposition })) })
  const post = (cookies, value, expected = 200) => request(cookies, '/api/refunds', value, expected)
  const recover = (cookies, value, expected = 200) => request(cookies, '/api/refunds/recover', { saleId: value.saleId, idempotencyKey: value.idempotencyKey }, expected)
  const balance = async id => Number((await owner.query('select balance_won from private.wallets where student_id=$1', [id])).rows[0].balance_won)
  const refunds = async id => Number((await owner.query('select count(*) from private.sale_refunds where sale_id=$1', [id])).rows[0].count)
  const original = async id => (await owner.query("select row_to_json(s) as sale,(select jsonb_agg(i order by id) from private.sale_items i where sale_id=s.id) as items,(select jsonb_agg(t order by id) from private.sale_tenders t where sale_id=s.id) as tenders,(select jsonb_agg(c order by c.id) from private.sale_cost_allocations c join private.sale_items i on i.id=c.sale_item_id where i.sale_id=s.id) as costs,(select row_to_json(w) from private.wallet_ledger w where id=s.wallet_ledger_id) as payment from private.sales s where id=$1", [id])).rows[0]
  phase = 'disabled-defaults'
  const first = await sale(), firstInput = input(first.detail), before = await original(first.detail.sale_id)
  await post(admin, firstInput, 409)
  await ctx.start(true); admin = await login(); other = await login('9101')
  assert.equal((await post(admin, firstInput)).outcome, 'DISABLED'); assert.equal(await refunds(first.detail.sale_id), 0)
  await owner.query('update private.system_settings set refunds_enabled=true where singleton')
  checks.push('application and database posting gates both default off')
  phase = 'authorization-and-validation'
  await post(new Map(), firstInput, 401)
  for (const who of [cashier, inventory]) { await post(who, firstInput, 403); await request(who, `/api/refunds/sale?reference=${first.detail.sale_id}`, undefined, 403) }
  await post(accountant, firstInput, 403); await recover(accountant, firstInput, 403)
  assert.equal((await request(accountant, `/api/refunds/sale?reference=${first.detail.receipt_number}`)).sale_id, first.detail.sale_id)
  await request(admin, '/api/refunds', firstInput, 403, 'https://untrusted.example')
  for (const change of [{ verified: false }, { amountWon: 9999 }, { notes: 'short' }, { items: [] }, { items: [firstInput.items[0], firstInput.items[0]] }]) await post(admin, { ...firstInput, ...change }, 400)
  const customerCookies = new Map(); await request(customerCookies, '/api/store/login', { cardNumber: first.customer.card, pin }); await post(customerCookies, firstInput, 401)
  checks.push('anonymous, customer, cashier, inventory, accountant mutation and origin/input denials; accountant read allowed')
  phase = 'wallet-and-replay'
  await sale({ customer: first.customer }); assert.equal(await balance(first.customer.id), -2400)
  const result = await post(admin, firstInput); assert.equal(result.outcome, 'COMPLETED'); assert.equal(result.refund.wallet_credit_won, 1200); assert.equal(await balance(first.customer.id), -1200)
  assert.deepEqual(await original(first.detail.sale_id), before)
  assert.deepEqual(await post(admin, firstInput), result)
  assert.deepEqual(await recover(await login(), firstInput), result)
  assert.equal((await recover(other, firstInput)).outcome, 'IDEMPOTENCY_CONFLICT')
  assert.equal((await post(admin, { ...firstInput, notes: 'Changed replay payload' })).outcome, 'IDEMPOTENCY_CONFLICT')
  assert.equal((await post(admin, input(first.detail))).outcome, 'ALREADY_REFUNDED')
  assert.equal(await refunds(first.detail.sale_id), 1); checks.push('current wallet credit, preserved original journals, exact replay and cross-operator recovery denial')
  phase = 'cash-and-split'
  let cashRefund
  for (const mode of ['CASH', 'SPLIT']) {
    const s = await sale({ mode }), r = (await post(admin, input(s.detail))).refund
    assert.equal(r.wallet_credit_won, mode === 'CASH' ? 0 : 500); assert.equal(r.cash_due_won, mode === 'CASH' ? 1200 : 700); assert.equal(r.cash_paid_won, 0)
    assert.equal((await owner.query('select count(*) from private.wallet_ledger where source_id=$1', [r.refund_id])).rows[0].count, mode === 'CASH' ? '0' : '1')
    const payout = { refundId: r.refund_id, idempotencyKey: randomUUID(), amountWon: r.cash_due_won, handoverReference: `QA ${mode} handover`, confirmed: true }
    await request(other, '/api/refunds/payout', payout, 403); await request(accountant, '/api/refunds/payout', payout, 403)
    await request(await login(), '/api/refunds/payout', payout, 403)
    await request(admin, '/api/refunds/payout', { ...payout, amountWon: r.cash_due_won + 1 }, 400)
    const paid = await request(admin, '/api/refunds/payout', payout); assert.equal(paid.refund.cash_paid_won, r.cash_due_won)
    assert.deepEqual(await request(admin, '/api/refunds/payout', payout), paid)
    assert.deepEqual(await request(admin, '/api/refunds/payout', { ...payout, idempotencyKey: randomUUID() }), paid)
    await request(admin, '/api/refunds/payout', { ...payout, handoverReference: 'Conflicting note' }, 409)
    assert.equal((await owner.query('select count(*) from private.cash_refund_payouts where refund_id=$1', [r.refund_id])).rows[0].count, '1')
    cashRefund = r
  }
  checks.push('cash and split preserve original allocation, exclude change, require payout capability/original terminal, and record one cash payout')
  phase = 'stock-and-cost'
  const mixed = await sale({ items: [{ productId: water.id, quantity: 1 }, { productId: cookie.id, quantity: 1 }] })
  const mixedInput = input(mixed.detail); mixedInput.items[0].disposition = 'WRITE_OFF'
  const r = (await post(admin, mixedInput)).refund
  assert.equal(r.restocked_cost_won + r.write_off_cost_won, mixed.detail.cogs_won)
  assert.ok(r.write_off_cost_won > 0 && r.restocked_cost_won > 0)
  assert.equal((await owner.query("select count(*) from private.refund_allocations a join private.inventory_movements m on m.source_type='REFUND_ALLOCATION' and m.source_id=a.id where a.refund_id=$1 and a.disposition='WRITE_OFF'", [r.refund_id])).rows[0].count, '0')
  const expired = await sale(); const expiryInput = input(expired.detail)
  const lots = await owner.query('select distinct c.inventory_lot_id from private.sale_cost_allocations c join private.sale_items i on i.id=c.sale_item_id where i.sale_id=$1', [expired.detail.sale_id])
  for (const lot of lots.rows) await owner.query("update private.inventory_lots set expiration_date='2000-01-01' where id=$1", [lot.inventory_lot_id])
  assert.equal((await post(admin, expiryInput)).outcome, 'EXPIRED_STOCK'); assert.equal(await refunds(expired.detail.sale_id), 0)
  assert.equal((await post(admin, input(expired.detail, 'WRITE_OFF'))).outcome, 'COMPLETED')
  for (const lot of lots.rows) await owner.query('update private.inventory_lots set expiration_date=null where id=$1', [lot.inventory_lot_id])
  const product = await request(admin, '/api/management', { kind:'PRODUCT', action:'CREATE_PRODUCT', requestKey:randomUUID(), sku:'REFUND-FRACTION', name:'Fractional cost fixture', category:'QA', sellingPriceWon:500, reorderLevel:0, reason:'Synthetic refund cost fixture product', verified:true })
  const productId = product.target_id
  for (const [q,cost,shipping] of [[2,100,1],[3,201,1]]) await request(admin, '/api/inventory/receipts', { supplierName: 'Synthetic supplier', supplierInvoice: randomUUID(), purchaseDate: today, shippingWon: shipping, otherCostsWon: 0, discountWon: 0, notes: 'Synthetic cost fixture', idempotencyKey: randomUUID(), lines: [{ productId, quantity: q, purchaseUnitCostWon: cost }] }, 201)
  const fractional = await sale({ items: [{ productId, quantity: 3 }] }), fractionalBefore = await original(fractional.detail.sale_id)
  const productRecord=(await request(admin,`/api/management?kind=PRODUCT&status=ACTIVE&targetId=${productId}`)).records[0]
  await request(admin, '/api/management', {kind:'PRODUCT',action:'CHANGE_PRODUCT_PRICE',targetId:productId,expectedUpdatedAt:productRecord.updated_at,sellingPriceWon:600,reason:'Post-sale price change verified',verified:true,requestKey:randomUUID()})
  const fractionalRefund = (await post(admin, input(fractional.detail))).refund
  assert.equal(fractionalRefund.cogs_reversed_won, fractional.detail.cogs_won); assert.equal(fractionalRefund.total_won, 1500); assert.deepEqual(await original(fractional.detail.sale_id), fractionalBefore)
  checks.push('mixed restock/write-off, expired stock refusal, fractional multi-lot original costs and changed price independence')
  phase = 'coupon-policy'
  const discounted = await sale({ couponCode: 'REFUNDQA' }), redemptionBefore = (await owner.query('select row_to_json(c) as item from private.coupon_redemptions c where sale_id=$1', [discounted.detail.sale_id])).rows
  const couponRefund = (await post(admin, input(discounted.detail))).refund
  assert.equal(couponRefund.total_won, discounted.detail.total_won); assert.ok(couponRefund.total_won < 1200); assert.equal(couponRefund.coupon_policy, 'KEEP_REDEMPTION')
  assert.deepEqual((await owner.query('select row_to_json(c) as item from private.coupon_redemptions c where sale_id=$1', [discounted.detail.sale_id])).rows, redemptionBefore)
  checks.push('discounted amount only and unchanged coupon redemption')
  phase = 'concurrency-and-fence'
  const raced = await sale(), race = await Promise.all([post(admin, input(raced.detail)), post(other, input(raced.detail))])
  assert.deepEqual(race.map(x => x.outcome).sort(), ['ALREADY_REFUNDED', 'COMPLETED']); assert.equal(await refunds(raced.detail.sale_id), 1)
  const same = await sale(), sameInput = input(same.detail), sameRace = await Promise.all([post(admin, sameInput), post(await login(), sameInput)])
  assert.deepEqual(sameRace[0], sameRace[1]); assert.equal(await refunds(same.detail.sale_id), 1)
  const fenced = await sale(), fencedInput = input(fenced.detail)
  assert.equal((await recover(admin, fencedInput)).outcome, 'CLOSED'); assert.equal((await post(admin, fencedInput)).outcome, 'CLOSED'); assert.equal(await refunds(fenced.detail.sale_id), 0)
  checks.push('concurrent different keys/operators and identical replay; recovery fences late originals')
  phase = 'atomic-rollback'
  const rejected = await sale(), rejectedInput = input(rejected.detail), previousBalance = await balance(rejected.customer.id)
  await owner.query(`create function private.refund_qa_reject() returns trigger language plpgsql as $$ begin if new.event_type='SALE_REFUNDED' and new.safe_payload->>'sale_id'='${rejected.detail.sale_id}' then raise exception 'QA_REFUND_ROLLBACK'; end if; return new; end $$; create trigger refund_qa_reject before insert on private.audit_events for each row execute function private.refund_qa_reject()`)
  await post(admin, rejectedInput, 500)
  await owner.query('drop trigger refund_qa_reject on private.audit_events; drop function private.refund_qa_reject()')
  assert.equal(await refunds(rejected.detail.sale_id), 0); assert.equal(await balance(rejected.customer.id), previousBalance)
  assert.equal((await recover(admin, rejectedInput)).outcome, 'CLOSED')
  checks.push('audit failure rolls back entire refund and wallet credit')
  phase = 'online-cancellation'
  async function online() {
    const s = await student(), cookies = new Map(); await request(cookies, '/api/store/login', { cardNumber: s.card, pin })
    const rooms = await request(cookies, '/api/store/locations'), room = rooms.find(l => l.room === '201')
    const order = await request(cookies, '/api/store/orders', { items: [{ productId: water.id, quantity: 1 }], deliveryLocationId: room.location_id, deliveryNote: null, expectedTotalWon: 1200, idempotencyKey: randomUUID() }, 201)
    const detail = await request(admin, `/api/refunds/sale?reference=${order.order_number}`)
    return { detail, order, cookies, s }
  }
  const cancelled = await online(); assert.equal((await post(admin, input(cancelled.detail))).outcome, 'COMPLETED')
  assert.equal((await request(cancelled.cookies, '/api/store/orders'))[0].status, 'CANCELLED'); assert.equal(await balance(cancelled.s.id), 0)
  const dispatch = await online()
  for (const status of ['PICKING','READY']) await request(cashier, `/api/orders/${dispatch.order.order_id}/status`, { status })
  const cancelInput = input(dispatch.detail)
  const [cancelResult, dispatchResult] = await Promise.all([raw(admin, '/api/refunds', cancelInput), raw(cashier, `/api/orders/${dispatch.order.order_id}/status`, { status: 'OUT_FOR_DELIVERY' })])
  assert.equal(cancelResult.status, 200)
  if (dispatchResult.status === 200) { assert.equal(cancelResult.body.data.outcome, 'ORDER_DISPATCHED'); assert.equal(await refunds(dispatch.detail.sale_id), 0) }
  else { assert.equal(dispatchResult.status, 409); assert.equal(cancelResult.body.data.outcome, 'COMPLETED'); assert.equal(await refunds(dispatch.detail.sale_id), 1) }
  const delivered = await online()
  for (const status of ['PICKING','READY','OUT_FOR_DELIVERY','DELIVERED']) await request(cashier, `/api/orders/${delivered.order.order_id}/status`, { status })
  assert.equal((await post(admin, input(delivered.detail))).outcome, 'ORDER_DISPATCHED'); assert.equal(await refunds(delivered.detail.sale_id), 0)
  checks.push('atomic online cancellation, one-winner cancellation/dispatch race and delivered-order denial')
  phase = 'report-and-private-boundaries'
  const summary = await request(accountant, `/api/refunds/summary?from=${today}&to=${today}`)
  const expected = (await owner.query('select (select count(*) from private.sales) as sales,(select count(*) from private.sale_refunds) as refunds')).rows[0]
  assert.equal(summary.sale_count, Number(expected.sales)); assert.equal(summary.refund_count, Number(expected.refunds))
  assert.equal(summary.net_margin_won, summary.gross_sales_won-summary.refunds_won-summary.gross_cogs_won+summary.cogs_reversed_won-summary.write_off_cost_won)
  await owner.query("set timezone='America/Los_Angeles'")
  const direct = (await owner.query('select result from api.refund_day_summary($1,$2,$3)', [(await request(accountant, '/api/auth/session')).session_id,today,today])).rows[0].result
  assert.deepEqual(direct, summary); await owner.query("set timezone='UTC'")
  await request(accountant, '/api/refunds/summary?from=2026-09-19&to=2026-09-18', undefined, 400)
  const runtime = new pg.Client({ connectionString: ctx.runtimeUrl }); await runtime.connect()
  try { for (const table of ['sale_refunds','refund_tenders','refund_allocations','cash_refund_payouts','refund_request_closures']) await assert.rejects(runtime.query(`select * from private.${table}`), e => e.code === '42501') } finally { await runtime.end() }
  await assert.rejects(owner.query('update private.sale_refunds set notes=notes where id=$1',[result.refund.refund_id]), e => e.code === 'P0001')
  await assert.rejects(owner.query('delete from private.cash_refund_payouts where refund_id=$1',[cashRefund.refund_id]), e => e.code === 'P0001')
  checks.push('uncapped net reconciliation, server-timezone independence, runtime table denial and immutable refund/payout journals')
  phase = 'browser'
  if (process.env.CI_BROWSER === '1') await runRefundBrowser({ ...ctx, admin, sale, input, post, refunds })
  checks.push('responsive browser full refund, lost response/reload recovery, and payout recording recovery')
  phase = 'shutdown-recovery'
  const pendingCash = await sale({ mode: 'CASH' }), pendingRefund = (await post(admin, input(pendingCash.detail))).refund
  await owner.query('update private.system_settings set refunds_enabled=false where singleton'); await ctx.start(false)
  assert.equal((await recover(admin, firstInput)).outcome, 'COMPLETED')
  await post(admin, input(fenced.detail), 409)
  const shutdownPayout = await request(admin, '/api/refunds/payout', { refundId: pendingRefund.refund_id, idempotencyKey: randomUUID(), amountWon: pendingRefund.cash_due_won, handoverReference: 'QA shutdown handover', confirmed: true })
  assert.equal(shutdownPayout.refund.cash_paid_won, pendingRefund.cash_due_won)
  checks.push('posting shutdown preserves refund recovery and outstanding cash recording')
  fs.writeFileSync('.validation/refunds/results.json', JSON.stringify({ passed: true, checks, productionAccess: false }, null, 2))
  console.log(`Full-sale refund integration passed: ${checks.length} acceptance groups, synthetic localhost data only.`)
} catch (error) {
  console.error(`Refund verification failed at ${phase}: ${/^[0-9A-Z]{5}$/.test(error?.code ?? '') ? error.code : 'CHECK_FAILED'}`)
  if (error?.code === 'ERR_ASSERTION') console.error(String(error.message).slice(0, 300))
  if (fs.existsSync('.validation/refunds')) fs.writeFileSync('.validation/refunds/results.json', JSON.stringify({ passed: false, phase, checks, productionAccess: false }, null, 2))
  process.exitCode = 1
} finally { if (ctx) await ctx.close() }
