import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'

// Called only by the localhost-only integration runner. All fixtures live in its disposable database.
export async function runTenderChecks({ owner, request, login, jar, card, studentPin }) {
  const admin = await login('9001'), cashier = await login('1001'), inventory = await login('2001')
  await request(jar(), '/api/pos/payment-policy', undefined, 401)
  assert.equal((await request(cashier, '/api/pos/payment-policy')).cash_enabled, false)
  await request(cashier, '/api/pos/payment-policy', { cashEnabled: true, endsAt: new Date(Date.now() + 3600000).toISOString(), eventName: 'Unauthorized' }, 403)
  const product = await request(inventory, '/api/inventory/products', { sku: `TENDER-${randomUUID().slice(0, 8)}`, name: 'Tender integration item', category: 'Tests', sellingPriceWon: 12000, reorderLevel: 0 })
  await request(inventory, '/api/inventory/receipts', { supplierName: 'Integration fixtures', supplierInvoice: randomUUID(), purchaseDate: '2026-09-07', shippingWon: 0, otherCostsWon: 0, discountWon: 0, notes: 'Disposable tender test stock', lines: [{ productId: product.reference_id, quantity: 30, purchaseUnitCostWon: 1000 }], idempotencyKey: randomUUID() })
  const items = [{ productId: product.reference_id, quantity: 1 }]
  const proposed = (mode, amount = null, lines = items, couponCode = null) => ({ items: lines, couponCode, tenderMode: mode, walletAmountWon: amount, idempotencyKey: randomUUID() })
  await request(cashier, '/api/pos/intents', proposed('CASH'), 409)
  await request(cashier, '/api/pos/intents', proposed('SPLIT', 7000), 409)
  await request(admin, '/api/pos/payment-policy', { cashEnabled: true, endsAt: new Date(Date.now() + 3600000).toISOString(), eventName: 'MICA Integration Festival' })
  assert.equal((await request(cashier, '/api/pos/payment-policy')).cash_enabled, false, 'Policy must be terminal scoped')
  const snapshot = async () => (await owner.query(`select jsonb_build_object(
    'wallets',(select jsonb_agg(jsonb_build_array(student_id,balance_won) order by student_id) from private.wallets),
    'sales',(select count(*) from private.sales),'tenders',(select count(*) from private.sale_tenders),
    'wallet_ledger',(select count(*) from private.wallet_ledger),'movements',(select count(*) from private.inventory_movements),
    'costs',(select count(*) from private.sale_cost_allocations),'coupons',(select count(*) from private.coupon_redemptions),
    'lots',(select jsonb_agg(jsonb_build_array(id,quantity_remaining) order by id) from private.inventory_lots)) as state`)).rows[0].state
  const scan = intent => request(admin, `/api/pos/intents/${intent.intent_id}/card`, { cardRead: card })
  const confirm = (intent, body, expected = 200) => request(admin, `/api/pos/intents/${intent.intent_id}/confirm`, body, expected)
  const unchanged = async (before, label) => assert.deepEqual(await snapshot(), before, label)

  let intent = await request(admin, '/api/pos/intents', proposed('SPLIT', 7000)); await scan(intent)
  let before = await snapshot()
  assert.equal((await confirm(intent, { pin: studentPin, cashReceivedWon: 4000 }, 409)).code, 'CASH_UNDERPAYMENT')
  await unchanged(before, 'Underpayment must leave every financial and inventory journal unchanged')
  const results = await Promise.all([confirm(intent, { pin: studentPin, cashReceivedWon: 10000 }), confirm(intent, { pin: studentPin, cashReceivedWon: 10000 })])
  const receipt = results[0]; assert.equal(results[1].sale_id, receipt.sale_id)
  assert.equal(receipt.total_won, 12000); assert.equal(receipt.wallet_tender_won, 7000); assert.equal(receipt.cash_tender_won, 5000)
  assert.equal(receipt.cash_received_won, 10000); assert.equal(receipt.change_given_won, 5000); assert.equal(receipt.cogs_won, 1000)
  assert.equal(receipt.balance_before_won - receipt.balance_after_won, 7000)
  const sale = (await owner.query('select * from private.sales where id=$1', [receipt.sale_id])).rows[0]
  assert.equal(sale.channel, 'POS')
  const tenders = (await owner.query('select tender_type,settled_amount_won,cash_received_won,change_given_won from private.sale_tenders where sale_id=$1 order by tender_type', [receipt.sale_id])).rows
  assert.deepEqual(tenders.map(t => [t.tender_type, Number(t.settled_amount_won)]), [['CASH', 5000], ['WALLET', 7000]])
  const ledger = (await owner.query('select amount_won from private.wallet_ledger where id=$1', [sale.wallet_ledger_id])).rows[0]
  assert.equal(Number(ledger.amount_won), -7000)
  assert.equal(Number((await owner.query('select count(*) from private.sale_items where sale_id=$1', [sale.id])).rows[0].count), 1)
  assert.equal(Number((await owner.query('select count(*) from private.sale_cost_allocations a join private.sale_items i on i.id=a.sale_item_id where i.sale_id=$1', [sale.id])).rows[0].count), 1)

  // A lost response may be replayed even when its original payment intent has expired.
  await owner.query("update private.payment_intents set expires_at=now()-interval '1 second' where id=$1", [intent.intent_id])
  assert.equal((await confirm(intent, { pin: studentPin, cashReceivedWon: 10000 })).sale_id, receipt.sale_id)
  intent = await request(admin, '/api/pos/intents', proposed('CASH')); before = await snapshot()
  const cashReceipt = await confirm(intent, { cashReceivedWon: 20000 })
  assert.equal(cashReceipt.balance_after_won, null); assert.equal(cashReceipt.cash_tender_won, 12000); assert.equal(cashReceipt.change_given_won, 8000)
  const after = await snapshot(); assert.deepEqual(after.wallets, before.wallets); assert.equal(after.wallet_ledger, before.wallet_ledger)
  assert.equal(after.sales - before.sales, 1); assert.equal(after.movements - before.movements, 1); assert.equal(after.costs - before.costs, 1)
  assert.equal((await owner.query('select student_id from private.sales where id=$1', [cashReceipt.sale_id])).rows[0].student_id, null)

  intent = await request(admin, '/api/pos/intents', proposed('SPLIT', 7000)); await scan(intent); before = await snapshot()
  await confirm(intent, { pin: '000000', cashReceivedWon: 10000 }, 401); await unchanged(before, 'Wrong PIN posts nothing')
  await request(admin, `/api/pos/intents/${intent.intent_id}/cancel`, {})
  await confirm(intent, { pin: studentPin, cashReceivedWon: 10000 }, 409); await unchanged(before, 'Cancelled payment posts nothing')

  // Force an inventory conflict after card authentication by selling the remaining stock to cash.
  const low = await request(inventory, '/api/inventory/products', { sku: `RACE-${randomUUID().slice(0, 8)}`, name: 'Last-item tender fixture', category: 'Tests', sellingPriceWon: 12000, reorderLevel: 0 })
  await request(inventory, '/api/inventory/receipts', { supplierName: 'Integration fixtures', supplierInvoice: randomUUID(), purchaseDate: '2026-09-07', shippingWon: 0, otherCostsWon: 0, discountWon: 0, notes: 'One item only', lines: [{ productId: low.reference_id, quantity: 1, purchaseUnitCostWon: 800 }], idempotencyKey: randomUUID() })
  const lowItems = [{ productId: low.reference_id, quantity: 1 }]
  const splitRace = await request(admin, '/api/pos/intents', proposed('SPLIT', 1000, lowItems)); await scan(splitRace)
  const cashRace = await request(admin, '/api/pos/intents', proposed('CASH', null, lowItems)); await confirm(cashRace, { cashReceivedWon: 12000 })
  before = await snapshot(); assert.equal((await confirm(splitRace, { pin: studentPin, cashReceivedWon: 11000 }, 409)).code, 'INVENTORY_SHORTAGE'); await unchanged(before, 'Inventory failure rolls back split sale, tenders, wallet, and COGS')

  // Coupon discount is allocated once before tender split, and identity-limited cash coupons are denied.
  const code = `TENDER${randomUUID().slice(0, 8).toUpperCase()}`
  const coupon = await request(inventory, '/api/coupons', { name: 'Tender fixed discount', code, discountType: 'FIXED', fixedAmountWon: 1000, percentageBps: null, minimumSubtotalWon: 0, maxDiscountWon: null, totalRedemptionLimit: 20, perStudentLimit: 2, startsAt: new Date(Date.now() - 60000).toISOString(), endsAt: null, idempotencyKey: randomUUID() })
  assert.equal((await request(admin, '/api/pos/intents', proposed('CASH', null, items, code), 409)).code, 'COUPON_IDENTITY_REQUIRED')
  intent = await request(admin, '/api/pos/intents', proposed('SPLIT', 1000, items, code)); await scan(intent)
  const discounted = await confirm(intent, { pin: studentPin, cashReceivedWon: 10000 })
  assert.equal(discounted.total_won, 11000); assert.equal(discounted.discount_won, 1000); assert.equal(discounted.wallet_tender_won, 1000); assert.equal(discounted.cash_tender_won, 10000)
  intent = await request(admin, '/api/pos/intents', proposed('SPLIT', 1000, items, code)); await scan(intent)
  await request(inventory, `/api/coupons/${coupon.coupon_id}/deactivate`, { reason: 'Test coupon revalidation' }); before = await snapshot()
  await confirm(intent, { pin: studentPin, cashReceivedWon: 10000 }, 409); await unchanged(before, 'Coupon failure posts nothing')

  // The wallet floor uses only the proposed wallet leg, even for a very large cash-backed sale.
  const expensiveItems = [{ productId: product.reference_id, quantity: 10 }]
  intent = await request(admin, '/api/pos/intents', proposed('SPLIT', 119999, expensiveItems)); await scan(intent); before = await snapshot()
  assert.equal((await confirm(intent, { pin: studentPin, cashReceivedWon: 1 }, 409)).code, 'WALLET_LIMIT'); await unchanged(before, 'Wallet floor failure posts nothing')

  // A database failure after inventory and wallet writes still rolls back the entire settlement.
  intent = await request(admin, '/api/pos/intents', proposed('SPLIT', 1000)); await scan(intent); before = await snapshot()
  await owner.query(`create function private.integration_fail_sale_audit() returns trigger language plpgsql as $$ begin if new.event_type='SALE_COMPLETED' then raise exception 'INTEGRATION_SIMULATED_DATABASE_FAILURE'; end if; return new; end $$;
    create trigger integration_fail_sale_audit before insert on private.audit_events for each row execute function private.integration_fail_sale_audit()`)
  try { await confirm(intent, { pin: studentPin, cashReceivedWon: 11000 }, 500); await unchanged(before, 'Late database failure rolls back wallet, tenders, stock, COGS, coupon and sale') }
  finally { await owner.query('drop trigger integration_fail_sale_audit on private.audit_events; drop function private.integration_fail_sale_audit()') }
  await request(admin, `/api/pos/intents/${intent.intent_id}/cancel`, {})
  intent = await request(admin, '/api/pos/intents', proposed('SPLIT', 1000)); await scan(intent)
  await owner.query("update private.payment_intents set expires_at=now()-interval '1 second' where id=$1", [intent.intent_id]); before = await snapshot()
  await confirm(intent, { pin: studentPin, cashReceivedWon: 11000 }, 401); await unchanged(before, 'Expired intent posts nothing')

  // Disable policy after a cash proposal. Confirmation must recheck current policy.
  intent = await request(admin, '/api/pos/intents', proposed('CASH'))
  await request(admin, '/api/pos/payment-policy', { cashEnabled: false, eventName: null }); before = await snapshot()
  await confirm(intent, { cashReceivedWon: 12000 }, 409); await unchanged(before, 'Disabled policy blocks outstanding cash proposals')
  assert.ok(Number((await owner.query("select count(*) from private.audit_events where event_type='TERMINAL_PAYMENT_POLICY_CHANGED'")).rows[0].count) >= 2)
  const accountant = await login('3001'); const reports = await request(accountant, '/api/reports/sales')
  const row = reports.find(r => r.receipt_number === receipt.receipt_number)
  assert.equal(row.revenue_won, 12000); assert.equal(row.wallet_tender_won, 7000); assert.equal(row.cash_tender_won, 5000)
  assert.equal(reports.filter(r => r.receipt_number === receipt.receipt_number).length, 1)
  assert.ok(reports.some(r => r.receipt_number === cashReceipt.receipt_number && r.student_name === null))
  // Date-range reports follow the school day in Korea, independent of database timezone.
  await owner.query("update private.sales set created_at='2034-12-31T15:00:00Z'::timestamptz where id=$1", [cashReceipt.sale_id])
  await owner.query("update private.sales set created_at='2034-12-31T14:59:59.999Z'::timestamptz where id=$1", [receipt.sale_id])
  const koreanDay = await request(accountant, '/api/reports/sales?from=2035-01-01&to=2035-01-01')
  assert.ok(koreanDay.some(row => row.receipt_number === cashReceipt.receipt_number))
  assert.ok(!koreanDay.some(row => row.receipt_number === receipt.receipt_number))
  const unreconciled = await owner.query('select s.id from private.sales s left join private.sale_tenders t on t.sale_id=s.id group by s.id having coalesce(sum(t.settled_amount_won),0)<>s.total_won or count(t.id)=0')
  assert.equal(unreconciled.rowCount, 0)
  await assert.rejects(owner.query('update private.sale_tenders set settled_amount_won=settled_amount_won'), /Journal entries cannot be changed/)
  // A new staff session on the same register can recover an earlier committed sale,
  // while another terminal cannot learn or cancel it.
  const originalIntentId = (await owner.query('select payment_intent_id from private.sales where id=$1', [receipt.sale_id])).rows[0].payment_intent_id
  const otherTerminal = await login('1001')
  await request(otherTerminal, `/api/pos/intents/${originalIntentId}/recover`, {}, 403)
  await request(admin, '/api/auth/login', { employeeCode: '9001', pin: '12345678' })
  before = await snapshot()
  const recovered = await request(admin, `/api/pos/intents/${originalIntentId}/recover`, {})
  assert.equal(recovered.state, 'completed'); assert.equal(recovered.receipt.sale_id, receipt.sale_id)
  assert.equal(recovered.items[0].lineTotalWon, 12000); await unchanged(before, 'Reauthentication recovery never charges again')
  const uncommitted = await request(admin, '/api/pos/intents', proposed('WALLET')); await scan(uncommitted)
  await request(admin, '/api/auth/login', { employeeCode: '9001', pin: '12345678' }); before = await snapshot()
  const cancelledRecovery = await request(admin, `/api/pos/intents/${uncommitted.intent_id}/recover`, {})
  assert.equal(cancelledRecovery.state, 'cancelled'); assert.equal(cancelledRecovery.receipt, null)
  await unchanged(before, 'Recovery cancels uncommitted proposals without financial mutation')
  // Stock-receipt recovery is read-only and bound to the same receiving person and terminal.
  const receiver = await login('2001')
  const receiptKey = randomUUID()
  const receivedStock = await request(receiver, '/api/inventory/receipts', { supplierName: 'Recovery fixtures', supplierInvoice: randomUUID(), purchaseDate: '2026-09-07', shippingWon: 0, otherCostsWon: 0, discountWon: 0, notes: 'Read-only receipt recovery fixture', lines: [{ productId: product.reference_id, quantity: 2, purchaseUnitCostWon: 900 }], idempotencyKey: receiptKey })
  const unrelatedReceiver = await login('2001')
  await request(unrelatedReceiver, '/api/inventory/receipts/recover', { idempotencyKey: receiptKey }, 403)
  await request(receiver, '/api/auth/login', { employeeCode: '2001', pin: '12345678' })
  before = await snapshot()
  const recoveredStock = await request(receiver, '/api/inventory/receipts/recover', { idempotencyKey: receiptKey })
  assert.equal(recoveredStock.receipt.receipt_id, receivedStock.receipt_id)
  assert.equal(recoveredStock.receipt.total_quantity, 2); await unchanged(before, 'Receipt recovery never creates stock or COGS twice')
  const unknownReceipt = await request(receiver, '/api/inventory/receipts/recover', { idempotencyKey: randomUUID() })
  assert.equal(unknownReceipt.receipt, null)
  await request(receiver, '/api/auth/login', { employeeCode: '9001', pin: '12345678' })
  await request(receiver, '/api/inventory/receipts/recover', { idempotencyKey: receiptKey }, 403)
  // No visible result may mean the first POST never reached the server. Replaying the
  // exact saved proposal and UUID is safe because the unique receipt row precedes stock writes.
  await request(receiver, '/api/auth/login', { employeeCode: '2001', pin: '12345678' })
  const retryKey = randomUUID()
  assert.equal((await request(receiver, '/api/inventory/receipts/recover', { idempotencyKey: retryKey })).receipt, null)
  const originalProposal = { supplierName: 'Recovery retry fixtures', supplierInvoice: randomUUID(), purchaseDate: '2026-09-07', shippingWon: 0, otherCostsWon: 0, discountWon: 0, notes: 'Exact original request reused after absent recovery', lines: [{ productId: product.reference_id, quantity: 3, purchaseUnitCostWon: 950 }], idempotencyKey: retryKey }
  before = await snapshot()
  const retriedReceipts = await Promise.all([request(receiver, '/api/inventory/receipts', originalProposal), request(receiver, '/api/inventory/receipts', originalProposal)])
  assert.equal(retriedReceipts[0].receipt_id, retriedReceipts[1].receipt_id)
  const afterRetry = await snapshot(); assert.equal(afterRetry.movements - before.movements, 1)
  const exactlyOnceStock = (await owner.query(`select
    (select count(*) from private.stock_receipts where idempotency_key=$1) as receipts,
    (select count(*) from private.stock_receipt_lines where receipt_id=$2) as lines,
    (select count(*) from private.inventory_movements where source_type='STOCK_RECEIPT' and source_id=$2) as movements,
    (select sum(l.quantity_remaining) from private.inventory_lots l join private.stock_receipt_lines sl on sl.id=l.receipt_line_id where sl.receipt_id=$2) as quantity`, [retryKey, retriedReceipts[0].receipt_id])).rows[0]
  assert.equal(Number(exactlyOnceStock.receipts), 1); assert.equal(Number(exactlyOnceStock.lines), 1)
  assert.equal(Number(exactlyOnceStock.movements), 1); assert.equal(Number(exactlyOnceStock.quantity), 3)
  await request(receiver, '/api/auth/login', { employeeCode: '2001', pin: '12345678' }); before = await snapshot()
  await request(receiver, '/api/inventory/receipts', originalProposal, 409)
  const reauthenticatedReceipt = await request(receiver, '/api/inventory/receipts/recover', { idempotencyKey: retryKey })
  assert.equal(reauthenticatedReceipt.receipt.receipt_id, retriedReceipts[0].receipt_id)
  await unchanged(before, 'Reauthenticated mutation conflict is safely recovered without duplicate stock')
  console.log('PASS: terminal cash policy, exact split, change, concurrent duplicate, expiry replay, wallet isolation, atomic failures, coupons, inventory, COGS and tender reports')
}
