import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'

export async function runRemediationChecks({ owner, request, login, jar, card, studentPin }) {
  const admin = await login('9001'), other = await login('9001'), cashier = await login('1001')
  const event = { cashEnabled: true, eventName: 'Remediation acceptance', endsAt: new Date(Date.now() + 3600000).toISOString() }
  await request(cashier, '/api/pos/payment-policy', event, 403)
  for (const endsAt of [null, new Date(Date.now() - 1000).toISOString(), new Date(Date.now() + 25 * 3600000).toISOString()]) await request(admin, '/api/pos/payment-policy', { ...event, endsAt }, 400)
  const policy = await request(admin, '/api/pos/payment-policy', event)
  assert.equal(policy.event_status, 'ACTIVE'); assert.equal(policy.cash_enabled, true); assert.equal(Date.parse(policy.ends_at), Date.parse(event.endsAt))
  const audit = (await owner.query("select * from private.audit_events where event_type='TERMINAL_PAYMENT_POLICY_CHANGED' order by created_at desc limit 1")).rows[0]
  assert.ok(audit.actor_user_id); assert.equal(Date.parse(audit.safe_payload.new_ends_at), Date.parse(event.endsAt)); assert.equal(audit.safe_payload.new_event_name, event.eventName)
  const product = (await request(admin, '/api/pos/catalog')).find(p => p.sku === 'WATER-001')
  const proposal = tenderMode => ({ items: [{ productId: product.id, quantity: 20 }], tenderMode, idempotencyKey: randomUUID() })
  const snapshot = async () => (await owner.query(`select jsonb_build_object(
    'wallets',(select jsonb_agg(jsonb_build_array(student_id,balance_won) order by student_id) from private.wallets),
    'sales',(select count(*) from private.sales),'tenders',(select count(*) from private.sale_tenders),
    'ledger',(select count(*) from private.wallet_ledger),'inventory',(select count(*) from private.inventory_movements),
    'cogs',(select count(*) from private.sale_cost_allocations),'coupons',(select count(*) from private.coupon_redemptions)) as state`)).rows[0].state
  const initial = await snapshot()
  const intent = await request(admin, '/api/pos/intents', proposal('SPLIT'))
  assert.equal(intent.wallet_tender_won, null); assert.equal(intent.cash_tender_won, null)
  await request(admin, `/api/pos/intents/${intent.intent_id}/confirm`, { pin: studentPin, cashReceivedWon: intent.total_won }, 409)
  await request(other, `/api/pos/intents/${intent.intent_id}/tender`, { walletAmountWon: 1 }, 404)
  await request(admin, `/api/pos/intents/${intent.intent_id}/tender`, { walletAmountWon: 1 }, 409)
  const scan = await request(admin, `/api/pos/intents/${intent.intent_id}/card`, { cardRead: card })
  assert.ok(scan.student_display_name); assert.equal(scan.minimum_balance_won, -15000)
  assert.equal(scan.maximum_wallet_won, Math.min(intent.total_won, Math.max(0, scan.current_balance_won + 15000)))
  await request(admin, `/api/pos/intents/${intent.intent_id}/tender`, { walletAmountWon: 0 }, 400)
  await request(admin, `/api/pos/intents/${intent.intent_id}/tender`, { walletAmountWon: intent.total_won + 1 }, 409)
  if (scan.maximum_wallet_won < intent.total_won) await request(admin, `/api/pos/intents/${intent.intent_id}/tender`, { walletAmountWon: scan.maximum_wallet_won + 1 }, 409)
  const amount = Math.min(1000, scan.maximum_wallet_won)
  assert.ok(amount > 0)
  const plan = await request(admin, `/api/pos/intents/${intent.intent_id}/tender`, { walletAmountWon: amount })
  assert.equal(plan.cash_tender_won, plan.total_won - amount)
  assert.equal((await request(admin, `/api/pos/intents/${intent.intent_id}/tender`, { walletAmountWon: amount })).wallet_tender_won, amount)
  await request(admin, `/api/pos/intents/${intent.intent_id}/tender`, { walletAmountWon: amount + 1 }, 409)
  assert.deepEqual(await snapshot(), initial, 'Card binding and tender setup do not mutate any financial or inventory journal')
  // The same bound intent can deliberately become wallet-only, with no zero-cash split.
  const small = await request(admin, '/api/pos/intents', { ...proposal('SPLIT'), items: [{ productId: product.id, quantity: 1 }] })
  const smallScan = await request(admin, `/api/pos/intents/${small.intent_id}/card`, { cardRead: card })
  if (smallScan.maximum_wallet_won === small.total_won) {
    const walletPlan = await request(admin, `/api/pos/intents/${small.intent_id}/tender`, { walletAmountWon: small.total_won })
    assert.equal(walletPlan.tender_mode, 'WALLET'); assert.equal(walletPlan.cash_tender_won, 0)
  }
  const cashIntent = await request(admin, '/api/pos/intents', proposal('CASH'))
  // Advance only the disposable terminal's stored end timestamp; production is never involved.
  await owner.query("update private.terminals set cash_ends_at=clock_timestamp()-interval '1 second' where id=(select terminal_id from private.staff_sessions where id=(select staff_session_id from private.payment_intents where id=$1))", [intent.intent_id])
  const expired = await request(admin, '/api/pos/payment-policy')
  assert.equal(expired.cash_enabled, false); assert.equal(expired.event_status, 'EXPIRED'); assert.equal(expired.event_name, event.eventName)
  for (const mode of ['CASH', 'SPLIT']) assert.equal((await request(admin, '/api/pos/intents', proposal(mode), 409)).code, 'CASH_DISABLED')
  await request(admin, '/api/pos/intents', proposal('WALLET'))
  for (const i of [intent, cashIntent]) assert.equal((await request(admin, `/api/pos/intents/${i.intent_id}/confirm`, { pin: i === intent ? studentPin : null, cashReceivedWon: i.total_won }, 409)).code, 'CASH_DISABLED')
  assert.deepEqual(await snapshot(), initial, 'Expired policy rolls back existing split and cash settlements')
  // A deliberate missing application RPC tests the real pg -> Drizzle -> HTTP boundary.
  await owner.query('alter function api.terminal_payment_policy_v2(uuid) rename to remediation_hidden_policy')
  try {
    const failure = await request(admin, '/api/pos/payment-policy', undefined, 503)
    assert.deepEqual(failure, { code: 'DATABASE_UPGRADE_REQUIRED', message: 'CampusPay needs a database update before this version can be used.' })
    assert.ok(!JSON.stringify(failure).includes('api.')); assert.ok(!JSON.stringify(failure).includes('postgres'))
  } finally { await owner.query('alter function api.remediation_hidden_policy(uuid) rename to terminal_payment_policy_v2') }
  // Server expiry still rejects both activity and a new payment; no browser heartbeat revives it.
  const expiring = await login('1001')
  const expiringIntent = await request(expiring, '/api/pos/intents', { ...proposal('WALLET'), items: [{ productId: product.id, quantity: 1 }] })
  await owner.query("update private.staff_sessions set expires_at=now()-interval '1 second' where id=(select staff_session_id from private.payment_intents where id=$1)", [expiringIntent.intent_id])
  assert.equal((await request(expiring, '/api/auth/activity', {}, 401)).code, 'SESSION_EXPIRED')
  await request(expiring, '/api/pos/intents', proposal('WALLET'), 401)
  await request(jar(), '/api/pos/payment-policy', undefined, 401)
  console.log('PASS: card-first split preparation, capacity bounds, immutable plan replay, wallet-only switch, bounded audited event policy, expired settlements, real missing-RPC compatibility, authoritative session expiry')
}
