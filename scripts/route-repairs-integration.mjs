// Invoked only by integration-test.mjs against its disposable localhost database.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { randomUUID } from 'node:crypto'

export async function runRouteRepairChecks({ owner, request, login, jar, base, h }) {
  assert.ok(['localhost', '127.0.0.1'].includes(owner.connectionParameters.host))
  assert.ok(['localhost', '127.0.0.1'].includes(new URL(base).hostname))
  const checks = [], admin = await login('9001'), inventory = await login('2001')
  const adminContext = await request(admin, '/api/auth/session')
  const stepUp = (studentId, purpose, cookies = admin) => request(cookies, '/api/security/step-up', {
    superAdminEmployeeCode: '9001', superAdminPin: '12345678', purpose, studentId,
  })
  async function partialStudent(withCard = true) {
    const id = randomUUID(), code = `REPAIR-${id.slice(0, 8)}`, card = `04${id.replaceAll('-', '').slice(0, 12)}`
    await owner.query('insert into private.students(id,student_code,display_name) values($1,$2,$3)', [id, code, `Repair fixture ${code}`])
    await owner.query('insert into private.wallets(student_id,balance_won) values($1,0)', [id])
    if (withCard) await owner.query('insert into private.student_cards(student_id,card_fingerprint,issued_by) values($1,$2,$3)', [id, h('CARD_HMAC_SECRET', card), adminContext.user_id])
    return { id, code, card }
  }
  const unchangedIdentity = async id => (await owner.query(`select to_jsonb(s) student,to_jsonb(w) wallet,
    (select jsonb_agg(to_jsonb(c) order by c.id) from private.student_cards c where c.student_id=s.id) cards,
    (select count(*)::integer from private.wallet_ledger where student_id=s.id) ledger
    from private.students s join private.wallets w on w.student_id=s.id where s.id=$1`, [id])).rows[0]
  const state = async id => (await request(admin, `/api/security/students?q=${id}`))[0]
  const repair = (student, token, expected = 200, extra = {}) => request(admin, `/api/security/students/${student.id}/complete-pin`, {
    authorizationToken: token, newPin: '562914', confirmationPin: '562914', identityVerified: true, ...extra,
  }, expected)

  for (const path of ['/api/pos/intents/not-a-uuid/confirm', '/api/security/students/nope/pin-reset', '/api/orders/nope/status', '/api/inventory/products/nope/price']) {
    await request(admin, path, {}, 400)
  }
  for (const path of ['/api/refunds/items?offset=bad', '/api/administration?staffOffset=-1', '/api/reconciliation?day=2026-02-30', '/api/reports/sales?from=garbage', '/api/cash/history?offset=1&offset=2']) {
    await request(admin, path, undefined, 400)
  }
  checks.push('malformed dynamic UUID/date/pagination inputs return safe 400 rather than internal errors')

  const roster = await partialStudent(false), partial = await partialStudent()
  const rosterBefore = await unchangedIdentity(roster.id), partialBefore = await unchangedIdentity(partial.id)
  assert.equal((await state(roster.id)).credential_state, 'ROSTER_ONLY')
  assert.equal((await state(partial.id)).credential_state, 'CARD_ONLY')
  for (const purpose of ['RESET_STUDENT_PIN', 'RESET_STUDENT_CARD']) {
    const error = await request(admin, '/api/security/step-up', { superAdminEmployeeCode: '9001', superAdminPin: '12345678', purpose, studentId: roster.id }, 409)
    assert.equal(error.code, 'ENROLLMENT_REQUIRED')
    assert.equal((await request(admin, '/api/security/step-up', { superAdminEmployeeCode: '9001', superAdminPin: '12345678', purpose, studentId: partial.id }, 409)).code, 'INCOMPLETE_ENROLLMENT')
  }
  await request(inventory, '/api/security/step-up', { superAdminEmployeeCode: '9001', superAdminPin: '12345678', purpose: 'COMPLETE_STUDENT_PIN', studentId: partial.id }, 403)
  const token = await stepUp(partial.id, 'COMPLETE_STUDENT_PIN')
  await repair(partial, token.authorizationToken, 400, { identityVerified: false })
  await repair(partial, 'invalid-token-'.repeat(4), 403)
  const otherPartial = await partialStudent()
  await repair(otherPartial, token.authorizationToken, 403)
  const repaired = await repair(partial, token.authorizationToken)
  assert.match(repaired.audit_reference, /^AUD-CREDENTIAL-REPAIR-/)
  assert.equal((await state(partial.id)).credential_state, 'READY')
  assert.equal((await state(partial.id)).pin_set, true)
  await repair(partial, token.authorizationToken, 409)
  assert.deepEqual(await unchangedIdentity(partial.id), partialBefore)
  assert.deepEqual(await unchangedIdentity(roster.id), rosterBefore)
  assert.deepEqual((await owner.query(`select
    (select count(*)::integer from private.student_credentials where student_id=$1) credentials,
    (select count(*)::integer from private.audit_events where subject_id=$1 and event_type='INCOMPLETE_ENROLLMENT_REPAIRED') audits`, [partial.id])).rows[0], { credentials: 1, audits: 1 })
  const customer = jar()
  await request(customer, '/api/store/login', { cardNumber: partial.card, pin: '562914' })
  checks.push('first issuance is not a reset; explicit card-only repair preserves identity/card/wallet and requires fresh role/purpose/student-bound approval')

  const race = await partialStudent(), tokens = [await stepUp(race.id, 'COMPLETE_STUDENT_PIN'), await stepUp(race.id, 'COMPLETE_STUDENT_PIN')]
  const responses = await Promise.all(tokens.map(t => fetch(base + `/api/security/students/${race.id}/complete-pin`, {
    method: 'POST', headers: { origin: base, 'content-type': 'application/json', cookie: [...admin].map(([k, v]) => `${k}=${v}`).join('; ') },
    body: JSON.stringify({ authorizationToken: t.authorizationToken, newPin: '562914', confirmationPin: '562914', identityVerified: true }),
  })))
  assert.deepEqual(responses.map(r => r.status).sort(), [200, 409])
  assert.equal((await owner.query('select count(*)::integer n from private.student_credentials where student_id=$1', [race.id])).rows[0].n, 1)
  const rollback = await partialStudent(), approval = await stepUp(rollback.id, 'COMPLETE_STUDENT_PIN')
  const rollbackBefore = await unchangedIdentity(rollback.id)
  await owner.query(`create function private.route_repair_failure() returns trigger language plpgsql set search_path='' as $$ begin if new.event_type='INCOMPLETE_ENROLLMENT_REPAIRED' and new.subject_id='${rollback.id}'::uuid then raise exception 'injected test failure'; end if; return new; end; $$; create trigger route_repair_failure before insert on private.audit_events for each row execute function private.route_repair_failure()`)
  try { await repair(rollback, approval.authorizationToken, 500) }
  finally { await owner.query('drop trigger route_repair_failure on private.audit_events; drop function private.route_repair_failure()') }
  assert.equal((await state(rollback.id)).credential_state, 'CARD_ONLY')
  assert.deepEqual(await unchangedIdentity(rollback.id), rollbackBefore)
  await repair(rollback, approval.authorizationToken)
  checks.push('concurrent repairs create exactly one credential; late audit failure rolls back both credential and approval consumption')

  const product = await request(inventory, '/api/inventory/products', { sku: `REPAIR-${randomUUID().slice(0, 8)}`, name: 'Repair stock fixture', category: 'Test', sellingPriceWon: 1200, reorderLevel: 0 })
  for (const cost of [100, 200]) await request(inventory, '/api/inventory/receipts', { supplierName: 'Local regression fixture', supplierInvoice: randomUUID(), purchaseDate: '2026-10-02', shippingWon: 0, otherCostsWon: 0, discountWon: 0, notes: 'Local regression fixture', lines: [{ productId: product.reference_id, quantity: 10, purchaseUnitCostWon: cost }], idempotencyKey: randomUUID() })
  const removal = { productId: product.reference_id, quantityToRemove: 12, reasonCode: 'DAMAGED', notes: 'Independent loss-response regression', idempotencyKey: randomUUID() }
  // Treat this successful response as lost. Recovery must find its original posting after reauthentication.
  const posted = await request(inventory, '/api/inventory/adjustments', removal, 201)
  const reauthenticated = await login('2001')
  const recovered = await request(reauthenticated, '/api/inventory/adjustments/recover', { idempotencyKey: removal.idempotencyKey })
  assert.equal(recovered.state, 'POSTED'); assert.equal(recovered.reference_id, posted.reference_id)
  assert.equal(recovered.quantity_removed, 12); assert.equal(recovered.total_cost_won, 1400)
  assert.equal((await request(reauthenticated, '/api/inventory/adjustments', removal, 201)).reference_id, posted.reference_id)
  await request(reauthenticated, '/api/inventory/adjustments', { ...removal, quantityToRemove: 1 }, 409)
  await request(admin, '/api/inventory/adjustments/recover', { idempotencyKey: removal.idempotencyKey }, 403)
  const closedKey = randomUUID()
  assert.equal((await request(reauthenticated, '/api/inventory/adjustments/recover', { idempotencyKey: closedKey })).state, 'CLOSED')
  await request(reauthenticated, '/api/inventory/adjustments', { ...removal, quantityToRemove: 1, idempotencyKey: closedKey }, 409)
  const racingRemoval = { ...removal, quantityToRemove: 1, idempotencyKey: randomUUID() }
  const replayed = await Promise.all([request(reauthenticated, '/api/inventory/adjustments', racingRemoval, 201), request(reauthenticated, '/api/inventory/adjustments', racingRemoval, 201)])
  assert.equal(replayed[0].reference_id, replayed[1].reference_id)
  const stock = (await owner.query('select sum(quantity_remaining)::integer n from private.inventory_lots where product_id=$1', [product.reference_id])).rows[0].n
  assert.equal(stock, 7)
  checks.push('multi-lot stock loss has durable same-operator recovery, changed-payload denial, cross-operator denial, late-request closure and single-effect concurrent replay')

  await request(reauthenticated, `/api/inventory/products/${product.reference_id}/price`, { newPriceWon: 1500, reason: 'Price change after catalog loaded' })
  const cashier = await login('1001')
  const intent = await request(cashier, '/api/pos/intents', { items: [{ productId: product.reference_id, quantity: 1 }], idempotencyKey: randomUUID() })
  assert.equal(intent.subtotal_won, 1500)
  assert.deepEqual(intent.items, [{ name: 'Repair stock fixture', quantity: 1, lineTotalWon: 1500 }])
  await request(cashier, `/api/pos/intents/${intent.intent_id}/card`, { cardRead: partial.card })
  const receipt = await request(cashier, `/api/pos/intents/${intent.intent_id}/confirm`, { pin: '562914' })
  assert.deepEqual(receipt.items, intent.items)
  assert.deepEqual((await request(cashier, `/api/pos/intents/${intent.intent_id}/recover`, {})).items, receipt.items)
  const unknownIntent = await request(cashier, '/api/pos/intents', { items: [{ productId: product.reference_id, quantity: 1 }], idempotencyKey: randomUUID() })
  await request(cashier, `/api/pos/intents/${unknownIntent.intent_id}/card`, { cardRead: partial.card })
  const originalDisplay = (await owner.query("select pg_get_functiondef('api.payment_display_items(uuid,uuid)'::regprocedure) definition")).rows[0].definition
  try {
    await owner.query(originalDisplay.replace('if v_sale is not null then', "if v_sale is not null then raise exception 'NOT_FOUND'; end if; if v_sale is not null then"))
    await request(cashier, `/api/pos/intents/${unknownIntent.intent_id}/confirm`, { pin: '562914' }, 503)
  } finally { await owner.query(originalDisplay) }
  const unknownRecovered = await request(cashier, `/api/pos/intents/${unknownIntent.intent_id}/recover`, {})
  assert.equal(unknownRecovered.state, 'completed')
  assert.equal((await owner.query('select count(*)::integer n from private.sales where payment_intent_id=$1', [unknownIntent.intent_id])).rows[0].n, 1)
  checks.push('normal and recovered receipt lines use server prices; a failed post-settlement display read remains unknown and never repeats settlement')

  const readiness = await request(admin, '/api/settings/readiness')
  assert.equal(readiness.capabilities.length, 7)
  for (const row of readiness.capabilities) assert.equal(typeof row.database, 'boolean')
  await request(cashier, '/api/settings/readiness', undefined, 403)
  assert.ok(!/password|pin_hash|postgresql:|token_hash/i.test(JSON.stringify(readiness)))
  checks.push('Super Admin readiness distinguishes application/database/dependency gates without exposing secrets or enabling posting')

  const header = (await owner.query("select id,purchase_subtotal_won,total_landed_cost_won from private.stock_receipts where receipt_number='DEMO-RCV-000001'")).rows[0]
  assert.ok(header)
  const reconcile = async () => (await owner.query("select private.daily_reconciliation_document(current_date)->'checks' checks")).rows[0].checks
  const beforeCheck = (await reconcile()).find(row => row.code === 'RECEIPT_COSTS').discrepancies
  try {
    await owner.query('update private.stock_receipts set purchase_subtotal_won=purchase_subtotal_won+1,total_landed_cost_won=total_landed_cost_won+1 where id=$1', [header.id])
    assert.equal((await reconcile()).find(row => row.code === 'RECEIPT_COSTS').discrepancies, beforeCheck + 1)
  } finally { await owner.query('update private.stock_receipts set purchase_subtotal_won=$2,total_landed_cost_won=$3 where id=$1', [header.id, header.purchase_subtotal_won, header.total_landed_cost_won]) }
  assert.equal((await reconcile()).find(row => row.code === 'RECEIPT_COSTS').discrepancies, beforeCheck)
  checks.push('receipt header/line cost discrepancies are enumerated by daily reconciliation; the fixture is restored exactly')

  if (process.env.CI_BROWSER === '1') {
    const { runRouteRepairBrowserChecks } = await import('./route-repairs-browser.mjs')
    await runRouteRepairBrowserChecks({ base, login, request, roster, partial: otherPartial })
    checks.push('actual-browser roster guidance, card-only repair, readiness and persisted stock recovery controls at desktop/mobile widths')
  }
  fs.mkdirSync('.validation/route-repairs', { recursive: true })
  fs.writeFileSync('.validation/route-repairs/results.json', JSON.stringify({ passed: true, fixture: 'disposable-localhost', checks, productionDataChanged: false }, null, 2))
  console.log(`PASS: ${checks.length} route/UI/database repair regression groups`)
}
