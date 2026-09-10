import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import fs from 'node:fs'

export async function runHardeningChecks({ owner, request, login, jar, base, card, studentPin }) {
  const checks = []
  const session = async cookies => request(cookies, '/api/auth/session')
  for (const [code, workflow] of [['9001','enrollment'], ['2001','inventory receiving'], ['3001','accounting adjustment'], ['9001','security']]) {
    const cookies = await login(code), context = await session(cookies)
    await owner.query("update private.staff_sessions set created_at=clock_timestamp()-interval '3 minutes',last_activity_at=clock_timestamp()-interval '3 minutes',expires_at=clock_timestamp()-interval '3 minutes'+private.session_timeout(role_snapshot) where id=$1", [context.session_id])
    const active = await request(cookies, '/api/auth/activity', {})
    assert.ok(Date.parse(active.expiresAt) - Date.now() > 14 * 60000, workflow)
    checks.push(`${workflow} >2 minutes and sliding renewal`)
  }
  for (const cause of ['idle', 'absolute', 'revoked', 'role', 'user', 'terminal']) {
    const cookies = await login('1001'), context = await session(cookies)
    const row = (await owner.query('select * from private.staff_sessions where id=$1', [context.session_id])).rows[0]
    try {
      if (cause === 'idle') await owner.query("update private.staff_sessions set expires_at=clock_timestamp()-interval '1 second' where id=$1", [row.id])
      if (cause === 'absolute') await owner.query("update private.staff_sessions set created_at=clock_timestamp()-interval '8 hours',expires_at=clock_timestamp()+interval '15 minutes' where id=$1", [row.id])
      if (cause === 'revoked') await owner.query('update private.staff_sessions set revoked_at=clock_timestamp() where id=$1', [row.id])
      if (cause === 'role') await owner.query("update public.staff_profiles set role='accountant' where auth_user_id=$1", [row.auth_user_id])
      if (cause === 'user') await owner.query('update public.staff_profiles set active=false where auth_user_id=$1', [row.auth_user_id])
      if (cause === 'terminal') await owner.query('update private.terminals set active=false where id=$1', [row.terminal_id])
      const before = (await owner.query('select expires_at,last_activity_at from private.staff_sessions where id=$1', [row.id])).rows[0]
      await request(cookies, '/api/auth/activity', {}, ['role','user'].includes(cause) ? 403 : 401)
      assert.deepEqual((await owner.query('select expires_at,last_activity_at from private.staff_sessions where id=$1', [row.id])).rows[0], before)
    } finally {
      await owner.query("update public.staff_profiles set active=true,role='cashier' where auth_user_id=$1", [row.auth_user_id])
      await owner.query('update private.terminals set active=true where id=$1', [row.terminal_id])
    }
    checks.push(`server ${cause} cannot be revived`)
  }
  const bounded = await login('1001'), boundedSession = await session(bounded)
  await owner.query("update private.staff_sessions set created_at=clock_timestamp()-interval '7 hours 59 minutes' where id=$1", [boundedSession.session_id])
  assert.ok(Date.parse((await request(bounded, '/api/auth/activity', {})).expiresAt) - Date.now() < 61000)
  checks.push('active cashier capped at original eight-hour deadline')

  // Inspect live definitions and execute both failure paths. Credential state
  // commits despite generic failures; no wall-clock equality assertion is used.
  const primitive = (await owner.query("select pg_get_functiondef('private.verify_pin_proof(text,text)'::regprocedure) as body")).rows[0].body
  assert.equal((primitive.match(/extensions.crypt\(/g) ?? []).length, 1)
  assert.ok(!primitive.includes('gen_salt'))
  const costs = (await owner.query("select distinct substring(pin_hash,1,7) as cost from private.staff_credentials union select distinct substring(pin_hash,1,7) from private.student_credentials union select substring(private.dummy_pin_hash(),1,7)")).rows
  assert.deepEqual(costs, [{ cost: '$2a$12$' }])
  const staffUnknown = await request(jar(), '/api/auth/login', { employeeCode: 'missing-hardening', pin: '00000000' }, 401)
  const staffWrong = await request(jar(), '/api/auth/login', { employeeCode: '1001', pin: '00000000' }, 401)
  assert.deepEqual(staffUnknown, staffWrong)
  const studentUnknown = await request(jar(), '/api/store/login', { cardNumber: '04FFFFFFFFFFFF', pin: '000000' }, 401)
  const studentWrong = await request(jar(), '/api/store/login', { cardNumber: card, pin: '000000' }, 401)
  assert.deepEqual(studentUnknown, studentWrong)
  await login('1001')
  const customer = jar(); await request(customer, '/api/store/login', { cardNumber: card, pin: studentPin })
  checks.push('live equal bcrypt-12 work and identical credential failure bodies')

  const inventory = await login('2001'), accountant = await login('3001'), admin = await login('9001')
  await request(inventory, '/api/reports/inventory')
  await request(inventory, '/api/reports/sales', undefined, 403)
  await request(inventory, '/api/reports/wallets', undefined, 403)
  await request(accountant, '/api/inventory/adjustments', { productId: randomUUID(), quantity: 1, reasonCode: 'DAMAGE', idempotencyKey: randomUUID() }, 403)
  const page = await fetch(base + '/reports', { headers: { cookie: [...inventory].map(([k,v]) => `${k}=${v}`).join('; ') } })
  assert.equal(page.status, 200); assert.ok((await page.text()).includes('Inventory value'))
  for (const path of ['/login', '/store/login', '/api/auth/session']) {
    const response = await fetch(base + path)
    assert.ok(response.headers.get('content-security-policy').includes("'strict-dynamic'"))
    assert.ok(!response.headers.get('content-security-policy').includes('unsafe-eval'))
    assert.ok(response.headers.get('permissions-policy')); assert.equal(response.headers.get('x-frame-options'), 'DENY')
    assert.equal(response.headers.get('strict-transport-security'), null)
    assert.match(response.headers.get('x-request-id'), /^[0-9a-f-]{36}$/)
  }
  checks.push('permission-aware reports and production security/correlation headers')

  const products = []
  for (let i=0; i<2; i++) {
    const product = await request(inventory, '/api/inventory/products', { sku: `HARD-${randomUUID().slice(0,12)}`, name: `Hardening stock ${i}`, category: 'Test', sellingPriceWon: 1000, reorderLevel: 0 })
    products.push(product.reference_id)
  }
  await request(inventory, '/api/inventory/receipts', { supplierName: 'Hardening fixture', supplierInvoice: randomUUID(), purchaseDate: '2026-09-08', shippingWon: 0, otherCostsWon: 0, discountWon: 0, notes: '', lines: products.map((productId,i) => ({ productId, quantity: 10, purchaseUnitCostWon: (i+1)*100 })), idempotencyKey: randomUUID() })
  const buyers = []
  for (let i=0;i<2;i++) {
    const fixtureCard = `04${randomUUID().replaceAll('-','').slice(0,12)}`
    const enrolled = await request(admin, '/api/students', { studentCode: `HARD-${randomUUID().slice(0,8)}`, displayName: `Hardening Buyer ${i}`, cardRead: fixtureCard, pin: '112233', confirmationPin: '112233', idempotencyKey: randomUUID() }, 201)
    const cookies = jar(); await request(cookies, '/api/store/login', { cardNumber: fixtureCard, pin: '112233' })
    buyers.push({ cookies, studentId: enrolled.student_id })
  }
  const destination = (await request(buyers[0].cookies, '/api/store/locations')).find(row => row.room === '201')
  const proposals = buyers.map((_, i) => ({ items: (i ? [...products].reverse() : products).map(productId => ({ productId, quantity: 2 })), couponCode: null, deliveryLocationId: destination.location_id, deliveryNote: 'Never log this fixture note', expectedTotalWon: 4000, idempotencyKey: randomUUID() }))
  // Force overlapping allocation without changing costing or transaction boundaries.
  await owner.query("create function private.hardening_allocation_delay() returns trigger language plpgsql set search_path='' as $$ begin perform pg_sleep(0.15); return new; end; $$; create trigger hardening_allocation_delay before update on private.inventory_lots for each row execute function private.hardening_allocation_delay()")
  let placed
  try { placed = await Promise.all(buyers.map((buyer, i) => request(buyer.cookies, '/api/store/orders', proposals[i], 201))) }
  finally { await owner.query('drop trigger hardening_allocation_delay on private.inventory_lots; drop function private.hardening_allocation_delay()') }
  assert.equal(new Set(placed.map(row => row.order_id)).size, 2)
  for (let i=0;i<2;i++) {
    assert.equal(placed[i].balance_after_won, -4000)
    assert.equal((await request(buyers[i].cookies, '/api/store/orders', proposals[i], 201)).order_id, placed[i].order_id)
    assert.equal((await request(buyers[i].cookies, '/api/store/orders/recover', { idempotencyKey: proposals[i].idempotencyKey })).order_id, placed[i].order_id)
  }
  const totals = (await owner.query(`select count(*)::int as sales,sum(s.total_won)::int as revenue,sum(s.cost_of_goods_sold_won)::int as cogs,
    (select sum(t.settled_amount_won)::int from private.sale_tenders t where t.sale_id=any(array_agg(s.id))) as tenders,
    (select sum(l.amount_won)::int from private.wallet_ledger l where l.id=any(array_agg(s.wallet_ledger_id))) as wallet
    from private.sales s join private.online_orders o on o.sale_id=s.id where o.id=any($1::uuid[])`, [placed.map(row => row.order_id)])).rows[0]
  assert.deepEqual(totals, { sales: 2, revenue: 8000, cogs: 1200, tenders: 8000, wallet: -8000 })
  const rows = (await owner.query("with chosen as (select sale_id,id from private.online_orders where id=any($1::uuid[])) select (select count(*)::int from private.sale_items where sale_id in(select sale_id from chosen)) as sale_items,(select count(*)::int from private.online_order_items where order_id in(select id from chosen)) as order_items,(select count(*)::int from private.sale_cost_allocations where sale_item_id in(select id from private.sale_items where sale_id in(select sale_id from chosen))) as allocations,(select count(*)::int from private.sale_tenders where sale_id in(select sale_id from chosen)) as tenders", [placed.map(row => row.order_id)])).rows[0]
  assert.deepEqual(rows, { sale_items: 4, order_items: 4, allocations: 4, tenders: 2 })
  const stock = (await owner.query('select product_id,sum(quantity_remaining)::int as quantity from private.inventory_lots where product_id=any($1::uuid[]) group by product_id', [products])).rows
  assert.ok(stock.every(row => row.quantity === 6))
  const movements = (await owner.query("select sum(quantity_change)::int as quantity,sum(total_cost_won)::int as cost from private.inventory_movements where product_id=any($1::uuid[]) and movement_type='SALE'", [products])).rows[0]
  assert.deepEqual(movements, { quantity: -8, cost: -1200 })
  await request(buyers[0].cookies, '/api/store/orders', { ...proposals[0], items: products.map(productId => ({ productId, quantity: 7 })), expectedTotalWon: 14000, idempotencyKey: randomUUID() }, 409)
  assert.equal((await owner.query('select count(*)::int as n from private.online_orders where student_id=any($1::uuid[])', [buyers.map(b => b.studentId)])).rows[0].n, 2)
  checks.push('overlapping reversed two-product online orders: exact wallets, sales, COGS, tenders, movements, stock, replay and oversell rejection')

  await request(buyers[1].cookies, '/api/store/orders/recover', { idempotencyKey: proposals[0].idempotencyKey }, 403)
  const abandoned = { ...proposals[0], idempotencyKey: randomUUID() }
  assert.equal(await request(buyers[0].cookies, '/api/store/orders/recover', { idempotencyKey: abandoned.idempotencyKey }), undefined)
  await request(buyers[0].cookies, '/api/store/orders', abandoned, 409)
  const otherClosedKey = randomUUID()
  await request(buyers[1].cookies, '/api/store/orders/recover', { idempotencyKey: otherClosedKey })
  await request(buyers[0].cookies, '/api/store/orders', { ...proposals[0], items: [{ productId: products[0], quantity: 1 }], expectedTotalWon: 1000, idempotencyKey: otherClosedKey }, 201)
  checks.push('opaque recovery is student-scoped and safely fences only its own late uncommitted request')

  await request(admin, '/api/pos/payment-policy', { cashEnabled: true, eventName: 'KST boundary test', endsAt: new Date(Date.now()+3600000).toISOString() })
  const original = (await owner.query("select pg_get_functiondef('private.business_date_label(timestamptz)'::regprocedure) as body")).rows[0].body
  await owner.query("set timezone='UTC'")
  try {
    for (const [instant, day] of [['2026-09-08T14:59:59Z','20260908'], ['2026-09-08T15:00:00Z','20260909']]) {
      const date = (await owner.query("select to_char(private.business_date($1::timestamptz),'YYYYMMDD') as day", [instant])).rows[0].day
      assert.equal(date, day)
      // Replace only the private formatter's input in this disposable database;
      // authorization and settlement clocks remain real and authoritative.
      await owner.query(original.replace('private.business_date(p_at)', `private.business_date('${instant}'::timestamptz)`))
      const intent = await request(admin, '/api/pos/intents', { items: [{ productId: products[0], quantity: 1 }], tenderMode: 'CASH', idempotencyKey: randomUUID() })
      assert.ok((await request(admin, `/api/pos/intents/${intent.intent_id}/confirm`, { pin: null, cashReceivedWon: 1000 })).receipt_number.startsWith(`SALE-${day}-`))
      const web = await request(buyers[0].cookies, '/api/store/orders', { ...proposals[0], items: [{ productId: products[1], quantity: 1 }], expectedTotalWon: 1000, idempotencyKey: randomUUID() }, 201)
      assert.ok(web.order_number.startsWith(`WEB-${day}-`))
    }
  } finally { await owner.query(original) }
  checks.push('UTC connection: actual POS/online references at 23:59:59 and 00:00:00 KST')

  for (const status of ['PLACED','PICKING','READY','OUT_FOR_DELIVERY','DELIVERED']) {
    await owner.query("update private.online_orders set status=$1::private.online_order_state,created_at=case when id=$2 then '2026-09-08T00:00:00Z'::timestamptz else '2026-09-08T01:00:00Z'::timestamptz end where id=any($3::uuid[])", [status, placed[0].order_id, placed.map(row => row.order_id)])
    const ids = (await request(admin, '/api/orders')).filter(row => placed.some(p => p.order_id === row.order_id)).map(row => row.order_id)
    assert.deepEqual(ids, (status === 'DELIVERED' ? [...placed].reverse() : placed).map(row => row.order_id))
  }
  checks.push('controlled timestamps: all four active stages FIFO, completed history newest-first')
  const victim = (await request(customer, '/api/store/session')).student_id
  for (let i=0;i<3;i++) await request(jar(), '/api/store/login', { cardNumber: card, pin: '000000' }, 401)
  const credentialLock = (await owner.query('select failed_attempts,locked_until from private.student_credentials where student_id=$1', [victim])).rows[0]
  assert.equal(credentialLock.failed_attempts, 3); assert.ok(credentialLock.locked_until)
  await request(jar(), '/api/store/login', { cardNumber: card, pin: studentPin }, 401)
  for (let i=0;i<10;i++) await request(jar(), '/api/store/login', { cardNumber: '04EEEEEEEEEEEE', pin: '000000' }, 401)
  assert.ok((await owner.query('select 1 from private.customer_login_limits where locked_until>clock_timestamp()')).rowCount > 0)
  const spoofed = await fetch(base + '/api/store/login', { method: 'POST', headers: { origin: base, 'content-type': 'application/json', 'x-forwarded-for': '198.51.100.77', 'x-real-ip': '198.51.100.88', 'x-vercel-forwarded-for': '198.51.100.99' }, body: JSON.stringify({ cardNumber: card, pin: studentPin }) })
  assert.equal(spoofed.status, 401)
  await owner.query('update private.student_credentials set failed_attempts=0,locked_until=null where student_id=$1', [victim])
  await request(jar(), '/api/store/login', { cardNumber: card, pin: studentPin }, 401)
  checks.push('persistent student lockout and IP lockout survive spoofed forwarded headers')
  fs.writeFileSync('.validation/hardening-results.json' , JSON.stringify({ passed: true, checks }, null, 2))
  console.log(`PASS: ${checks.length} hardening coverage groups`)
}
