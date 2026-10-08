import test, { afterEach, mock } from 'node:test'
import assert from 'node:assert/strict'
import { register } from 'node:module'
register('./checkout-store-test-loader.mjs', import.meta.url)
const { addProduct, changeQuantity, reconcileCart } = await import('../src/features/pos/cart.ts')
const { checkoutReducer: reduce, initialCheckoutState: initial, couponBlocksCheckout } = await import('../src/features/pos/checkout-state.ts')
const { confirmedReceipt } = await import('../src/features/pos/confirmed-receipt.ts')
const { withStoreTimeout, StoreRequestTimeoutError } = await import('../src/features/store/request-timeout.ts')
const { placeOnlineOrder, recoverCustomerOrder, quoteCustomerOrder } = await import('../src/features/store/client.ts')
const { apiFetch, ClientApiError } = await import('../src/lib/api/client.ts')
afterEach(() => { mock.restoreAll(); mock.timers.reset() })
const product = (stock = 200, id = 'a') => ({ id, name: id, stock_on_hand: stock, sold_out: stock === 0, selling_price_won: 1000 })
const quote = { subtotal_won: 2000, discount_won: 300, total_won: 1700, coupon_name: 'Synthetic coupon', code_masked: '****TEST' }
const request = (state, id = 'request-a') => ({ id, revision: state.revision, code: 'TEST' })
const start = (state, req) => reduce(state, { type: 'coupon-start', request: req })
const result = (state, req, next = quote) => reduce(state, { type: 'coupon-result', request: req, quote: next })
const cart = (state, next) => reduce(state, { type: 'cart', update: () => next })

for (const [value, stock, expected] of [[-1,200,0],[0,200,0],[1,200,1],[98,200,98],[99,200,99],[100,200,99],[10000,3,3],[99,0,0],[4,3,3],[1.9,200,1],[Infinity,200,0],[NaN,200,0]]) {
  test(`cart direct quantity ${value}, stock ${stock} -> ${expected}`, () => {
    const actual = changeQuantity({}, 'a', value, stock)
    assert.equal(actual.a ?? 0, expected)
    assert.ok(Object.values(actual).every(n => Number.isInteger(n) && n > 0 && n <= 99))
  })
}
test('repeated product add/increment cap at 99 and retain no-op identity', () => {
  let state = {}
  for (let i = 0; i < 200; i++) state = addProduct(state, product())
  assert.equal(state.a, 99)
  assert.equal(addProduct(state, product()), state)
  assert.equal(changeQuantity(state, 'a', 1, 200), state)
  assert.equal(changeQuantity(state, 'a', -1, 200).a, 98)
})
test('stock refresh lowers cap, drops missing/sold-out lines, preserves original input', () => {
  const original = { a: 99, b: 2, c: 1 }
  assert.deepEqual(reconcileCart(original, [product(7), product(0, 'b')]), { a: 7 })
  assert.deepEqual(original, { a: 99, b: 2, c: 1 })
  assert.deepEqual(reconcileCart({ a: 3 }, [product(500)]), { a: 3 })
})
for (const [name, next] of [['quantity changed', { a: 2 }], ['product added', { a: 1, b: 1 }], ['product removed', {}]]) {
  test(`delayed coupon discarded when ${name}`, () => {
    let state = cart(initial, { a: 1 }); const req = request(state)
    state = start(state, req); assert.equal(couponBlocksCheckout(state.coupon), true)
    state = cart(state, next); const before = state
    assert.equal(result(state, req), before)
    assert.equal(state.coupon.status, 'idle')
  })
}
test('A -> B -> A cart is a distinct revision, never accepts the first response', () => {
  let state = cart(initial, { a: 1 }); const req = request(state)
  state = start(state, req); state = cart(state, { a: 2 }); state = cart(state, { a: 1 })
  assert.equal(result(state, req), state)
})
for (const outcome of ['coupon-result', 'coupon-error']) {
  test(`replaced coupon ignores late ${outcome}, including stale errors/finally`, () => {
    let state = cart(initial, { a: 1 }); const first = request(state)
    state = start(state, first); const second = request(state, 'request-b')
    state = start(state, second)
    const stale = reduce(state, { type: outcome, request: first, quote, message: 'Old failure' })
    assert.equal(stale, state); assert.equal(couponBlocksCheckout(stale.coupon), true)
    state = result(state, second)
    assert.equal(state.coupon.status, 'ready'); assert.equal(state.coupon.quote, quote)
  })
}
test('clear invalidates in-flight coupon; errors block checkout until retry or clear', () => {
  let state = cart(initial, { a: 1 }); const req = request(state)
  state = start(state, req); state = reduce(state, { type: 'coupon-clear' })
  assert.equal(result(state, req), state)
  state = start(state, req); state = reduce(state, { type: 'coupon-error', request: req, message: 'Timeout' })
  assert.equal(couponBlocksCheckout(state.coupon), true)
  assert.equal(couponBlocksCheckout(reduce(state, { type: 'coupon-clear' }).coupon), false)
})
test('catalog refresh invalidates quote even when quantities remain equal', () => {
  let state = cart(initial, { a: 1 }); const req = request(state)
  state = result(start(state, req), req)
  state = reduce(state, { type: 'cart', update: value => value, invalidate: true })
  assert.equal(state.coupon.status, 'idle'); assert.equal(result(state, req), state)
})
const receipt = { sale_id: 'sale-a', subtotal_won: 2468, discount_won: 247, total_won: 2221, cash_tender_won: 1221, wallet_tender_won: 1000, cash_received_won: 5000, change_given_won: 3779 }
const sale = { state: 'completed', receipt, items: [{ name: 'Stored product name', quantity: 2, lineTotalWon: 2468 }] }
test('normal/recovered receipts retain exact stored item, discount, rounding and tender amounts', () => {
  assert.equal(confirmedReceipt(sale, receipt), sale)
  assert.equal(confirmedReceipt(sale), sale)
  assert.deepEqual(sale.receipt, receipt)
})
for (const bad of [ { ...sale, items: [] }, { ...sale, items: [{ name: 'Stale catalog', quantity: 2, lineTotalWon: 2000 }] }, { ...sale, receipt: { ...receipt, sale_id: 'sale-b' } }, { state: 'cancelled', receipt: null, items: [] } ]) {
  test(`no invented balancing line or loss of known approval: ${JSON.stringify(bad)}`, () => {
    assert.throws(() => confirmedReceipt(bad, receipt), /Recover the original payment/)
  })
}
test('authoritative cancelled recovery is distinct from a transport failure', () => assert.equal(confirmedReceipt({ state: 'cancelled', receipt: null, items: [] }), null))

const input = { items: [{ productId: 'a', quantity: 1 }], couponCode: null, deliveryLocationId: 'room', deliveryNote: null, idempotencyKey: '11111111-1111-4111-8111-111111111111' }
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve() }
for (const [name, action] of [['place', () => placeOnlineOrder(input)], ['recover', () => recoverCustomerOrder(input.idempotencyKey)], ['quote', () => quoteCustomerOrder(input.items, null)]]) {
  test(`${name}: stalled fetch has bounded, non-rejection outcome; no automatic retry`, async () => {
    mock.timers.enable({ apis: ['setTimeout'] })
    const fetchMock = mock.method(globalThis, 'fetch', () => new Promise(() => {}))
    const promise = action()
    const assertion = assert.rejects(promise, error => error instanceof StoreRequestTimeoutError && !(error instanceof ClientApiError))
    await flush(); mock.timers.tick(30_000); await assertion
    assert.equal(fetchMock.mock.callCount(), 1)
    assert.equal(fetchMock.mock.calls[0].arguments[1].signal.aborted, true)
    if (name !== 'quote') assert.equal(JSON.parse(fetchMock.mock.calls[0].arguments[1].body).idempotencyKey, input.idempotencyKey)
  })
}
test('stalled response body is also bounded; late successful response cannot settle twice', async () => {
  mock.timers.enable({ apis: ['setTimeout'] })
  let resolveBody
  mock.method(globalThis, 'fetch', async () => ({ ok: true, status: 201, redirected: false, json: () => new Promise(resolve => { resolveBody = resolve }) }))
  const promise = placeOnlineOrder(input); const outcomes = []
  void promise.then(value => outcomes.push(value), error => outcomes.push(error.name))
  await flush(); assert.equal(typeof resolveBody, 'function')
  mock.timers.tick(30_000); await assert.rejects(promise, StoreRequestTimeoutError)
  resolveBody({ ok: true, data: { order_id: 'committed-order' } }); await flush()
  assert.deepEqual(outcomes, ['StoreRequestTimeoutError'])
})
test('committed-but-lost placement and repeated recovery retain original key, issue no replacement POST', async () => {
  mock.timers.enable({ apis: ['setTimeout'] })
  const calls = [], receipt = { order_id: 'one-order', total_won: 1000 }
  let recovery = 0, charges = 0
  mock.method(globalThis, 'fetch', async (path, init) => {
    calls.push({ path, body: JSON.parse(init.body) })
    if (path === '/api/store/orders') { charges++; return new Promise(() => {}) }
    if (++recovery === 1) return new Promise(() => {})
    return Response.json({ ok: true, data: receipt })
  })
  for (const action of [() => placeOnlineOrder(input), () => recoverCustomerOrder(input.idempotencyKey)]) {
    const promise = action(); const assertion = assert.rejects(promise, StoreRequestTimeoutError)
    await flush(); mock.timers.tick(30_000); await assertion
  }
  assert.deepEqual(await recoverCustomerOrder(input.idempotencyKey), receipt)
  assert.deepEqual(await recoverCustomerOrder(input.idempotencyKey), receipt)
  assert.equal(charges, 1)
  assert.ok(calls.every(call => call.body.idempotencyKey === input.idempotencyKey))
  assert.equal(calls.filter(call => call.path === '/api/store/orders').length, 1)
  // This transport fixture proves client request behavior; native browser tests
  // independently query actual orders/sales/ledger for database uniqueness.
})
test('confirmed application rejection remains a rejection, not a timeout', async () => {
  mock.method(globalThis, 'fetch', async () => Response.json({ ok: false, error: { code: 'CONFLICT', message: 'Price changed' } }, { status: 409 }))
  await assert.rejects(placeOnlineOrder(input), error => error instanceof ClientApiError && error.status === 409)
})
test('late rejection after deadline is consumed without an unhandled rejection', async () => {
  mock.timers.enable({ apis: ['setTimeout'] })
  let rejectLate
  const promise = withStoreTimeout(() => new Promise((resolve, reject) => { rejectLate = reject }))
  const assertion = assert.rejects(promise, StoreRequestTimeoutError)
  await flush(); mock.timers.tick(30_000); await assertion
  rejectLate(new Error('late transport failure')); await flush()
})
test('successful parsing clears its deadline and keeps authoritative null recovery', async () => {
  mock.timers.enable({ apis: ['setTimeout'] })
  mock.method(globalThis, 'fetch', async () => Response.json({ ok: true, data: null }))
  assert.equal(await recoverCustomerOrder(input.idempotencyKey), null)
  mock.timers.tick(60_000)
  assert.equal(await withStoreTimeout(() => apiFetch('/api/store/orders/recover')), null)
})
