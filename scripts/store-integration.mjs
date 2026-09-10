import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'

// Called only by the isolated-localhost integration runner with its existing fixtures.
export async function runStoreRefreshChecks({ request, jar, login, owner, base, customer, card, studentPin, sid, water, east201, webOrder }) {
  const anonymous = jar()
  for (const path of ['/api/store/catalog', '/api/store/locations', '/api/store/orders', '/api/store/session']) await request(anonymous, path, undefined, 401)
  await request(anonymous, '/api/store/quote', { items: [{ productId: water.id, quantity: 1 }], couponCode: null }, 401)
  const staff = await login('9001')
  for (const path of ['/api/store/catalog', '/api/store/locations', '/api/store/orders']) await request(staff, path, undefined, 401)
  for (const path of ['/api/pos/catalog', '/api/orders', '/api/accounting/students', '/api/security/students']) await request(customer, path, undefined, 401)
  for (const path of ['/store', '/store/orders', '/store/account']) {
    const response = await fetch(base + path, { redirect: 'manual' })
    assert.equal(response.status, 307)
    assert.ok(response.headers.get('location').includes('/store/login?next='))
  }
  const loginPage = await (await fetch(base + '/store/login')).text()
  assert.match(loginPage, /Sign in to MICA Money/)
  assert.match(loginPage, /Visit.*E202/)
  assert.match(loginPage, /How to get a MICA Money Card/)
  assert.doesNotMatch(loginPage, /Bottled Water|Create Account|Register Online/)
  const customerCookies = () => [...customer].map(([key, value]) => `${key}=${value}`).join('; ')
  const redirect = await fetch(base + '/store/login?next=//untrusted.example', { redirect: 'manual', headers: { cookie: customerCookies() } })
  let destination = redirect.headers.get('location')
  if (redirect.status === 200) {
    // Next.js emits a specific refresh tag when an async page redirects after streaming starts.
    const html = await redirect.text()
    const meta = html.match(/<meta\b[^>]*id="__next-page-redirect"[^>]*>/)?.[0]
    assert.ok(meta, 'Signed-in login must redirect, never render a login form or external destination')
    destination = meta.match(/content="[01];url=([^"]+)"/)?.[1] ?? null
  } else assert.equal(redirect.status, 307)
  assert.ok(destination, 'Redirect destination must be present')
  assert.equal(new URL(destination, base).href, base + '/store', 'Return navigation must stay on the local approved customer page')
  await assert.rejects(owner.query('select * from api.store_catalog()'), /does not exist/)
  await assert.rejects(owner.query('select * from api.store_delivery_locations()'), /does not exist/)
  await assert.rejects(owner.query('select * from api.store_catalog($1)', [randomUUID()]), /UNAUTHENTICATED|SESSION_EXPIRED/)

  const snapshot = async () => (await owner.query(`select jsonb_build_object(
    'balance', (select balance_won from private.wallets where student_id = $1),
    'sales', (select count(*) from private.sales),
    'orders', (select count(*) from private.online_orders),
    'ledger', (select count(*) from private.wallet_ledger),
    'stock', (select sum(quantity_remaining) from private.inventory_lots),
    'redemptions', (select count(*) from private.coupon_redemptions)
  ) as state`, [sid])).rows[0].state
  const before = await snapshot()
  const items = [{ productId: water.id, quantity: 1 }]
  const quote = await request(customer, '/api/store/quote', { items, couponCode: null })
  assert.equal(quote.total_won, water.selling_price_won)
  assert.equal(quote.balance_before_won - quote.balance_after_won, quote.total_won)
  assert.deepEqual(await snapshot(), before, 'Order review must have no financial or inventory effects')
  const mismatch = await request(customer, '/api/store/orders', {
    items, couponCode: null, deliveryLocationId: east201.location_id, deliveryNote: null,
    idempotencyKey: randomUUID(), expectedTotalWon: quote.total_won + 1,
  }, 409)
  assert.equal(mismatch.code, 'CONFLICT')
  assert.deepEqual(await snapshot(), before, 'Changed review totals must roll back completely')
  await request(customer, '/api/store/quote', { items, couponCode: 'ONLINE100' }, 409)
  assert.deepEqual(await snapshot(), before, 'Rejected coupons must have no effects')

  const mine = await request(customer, '/api/store/orders')
  const order = mine.find((entry) => entry.order_id === webOrder.order_id)
  assert.deepEqual(order.timeline.map((event) => event.status), ['PLACED', 'PICKING', 'READY', 'OUT_FOR_DELIVERY', 'DELIVERED'])
  assert.ok(order.timeline.every((event) => Number.isFinite(Date.parse(event.created_at))))
  const queue = await request(staff, '/api/orders')
  assert.deepEqual(queue.find((entry) => entry.order_id === order.order_id).timeline, order.timeline)

  // Simulate an unknown successful response, session loss, then same-UUID recovery.
  const saved = (await owner.query('select idempotency_key from private.online_orders where id=$1', [webOrder.order_id])).rows[0]
  const session = await request(customer, '/api/store/session')
  await owner.query("update private.customer_sessions set expires_at = now() - interval '1 second' where id = $1", [session.session_id])
  await request(customer, '/api/store/orders', undefined, 401)
  await request(customer, '/api/store/login', { cardNumber: card, pin: studentPin })
  const replay = await request(customer, '/api/store/orders', {
    items, couponCode: 'ONLINE100', deliveryLocationId: east201.location_id,
    deliveryNote: 'Integration room delivery', idempotencyKey: saved.idempotency_key, expectedTotalWon: webOrder.total_won,
  }, 201)
  assert.equal(replay.order_id, webOrder.order_id)
  assert.deepEqual(await snapshot(), before, 'Reauthentication and retry must not charge a second order')
  console.log('PASS: authentication-first store, private catalog RPCs, safe redirects, review rollback, exact timeline, and reauthentication-safe idempotency')
}
