import test, { afterEach, mock } from 'node:test'
import assert from 'node:assert/strict'
import * as client from '../src/lib/api/client.ts'

const { apiFetch, ClientApiError } = client
const json = (value, status = 200) => Response.json(value, { status })
const withResponse = (response) => mock.method(globalThis, 'fetch', async () => response)
afterEach(() => mock.restoreAll())

for (const data of [{ value: 7 }, [], null, false, 0, '']) {
  test(`returns valid successful data: ${JSON.stringify(data)}`, async () => {
    withResponse(json({ ok: true, data }))
    assert.deepEqual(await apiFetch('/api/example'), data)
  })
}
for (const status of [400, 401, 403, 409, 429, 500, 503]) {
  test(`preserves a validated API rejection with HTTP ${status}`, async () => {
    withResponse(json({ ok: false, error: { code: 'TEST_ERROR', message: 'Safe server message' } }, status))
    await assert.rejects(apiFetch('/api/example'), (error) => {
      assert.ok(error instanceof ClientApiError)
      assert.equal(error.code, 'TEST_ERROR')
      assert.equal(error.status, status)
      assert.equal(error.message, 'Safe server message')
      return true
    })
  })
}

const malformed = [
  ['contradictory error with success status', () => json({ ok: false, error: { code: 'BAD_REQUEST', message: 'SECRET_DO_NOT_ECHO' } }, 200)],
  ['non-application error code', () => json({ ok: false, error: { code: '<html>', message: 'SECRET_DO_NOT_ECHO' } }, 400)],
  ['oversized error code', () => json({ ok: false, error: { code: 'A'.repeat(81), message: 'SECRET_DO_NOT_ECHO' } }, 400)],
  ['oversized error message', () => json({ ok: false, error: { code: 'BAD_REQUEST', message: 'SECRET_DO_NOT_ECHO'.repeat(100) } }, 400)],
  ['text deployment error', () => new Response('The deployment could not be found. SECRET_DO_NOT_ECHO', { status: 404 })],
  ['HTML login', () => new Response('<html>SECRET_DO_NOT_ECHO</html>', { status: 200 })],
  ['empty success', () => new Response(null, { status: 204 })],
  ['malformed JSON', () => new Response('{"ok":', { status: 502 })],
  ['null', () => json(null)],
  ['array', () => json([])],
  ['boolean', () => json(false)],
  ['missing ok', () => json({ data: 'SECRET_DO_NOT_ECHO' })],
  ['missing successful data', () => json({ ok: true })],
  ['string ok', () => json({ ok: 'true', data: 1 })],
  ['missing error', () => json({ ok: false }, 400)],
  ['null error', () => json({ ok: false, error: null }, 401)],
  ['array error', () => json({ ok: false, error: [] }, 403)],
  ['missing error code', () => json({ ok: false, error: { message: 'SECRET_DO_NOT_ECHO' } }, 400)],
  ['non-string error code', () => json({ ok: false, error: { code: 1, message: 'SECRET_DO_NOT_ECHO' } }, 400)],
  ['empty error code', () => json({ ok: false, error: { code: '', message: 'SECRET_DO_NOT_ECHO' } }, 400)],
  ['blank error message', () => json({ ok: false, error: { code: 'TEST', message: ' ' } }, 400)],
  ['non-string error message', () => json({ ok: false, error: { code: 'TEST', message: null } }, 400)],
  ['contradictory success with error status', () => json({ ok: true, data: {} }, 409)],
]
for (const [name, makeResponse] of malformed) {
  test(`unconfirmed, not a known rejection: ${name}`, async () => {
    const response = makeResponse()
    const fetchMock = withResponse(response)
    await assert.rejects(apiFetch('/api/example', { method: 'POST' }), (error) => {
      assert.equal(typeof client.UnconfirmedApiResponseError, 'function')
      assert.ok(error instanceof client.UnconfirmedApiResponseError)
      assert.equal(error instanceof ClientApiError, false)
      assert.equal(error.status, response.status)
      assert.match(error.message, /could not be confirmed/i)
      assert.equal(error.message.includes('SECRET_DO_NOT_ECHO'), false)
      // Checkout's existing contract: only a confirmed API rejection may
      // discard the original payment recovery marker.
      const knownRejection = error instanceof ClientApiError && error.status < 500
      assert.equal(knownRejection, false)
      return true
    })
    assert.equal(fetchMock.mock.callCount(), 1, 'a mutation must never be automatically retried')
  })
}

test('network failure stays unconfirmed and is not retried', async () => {
  const failure = new TypeError('Connection lost')
  const fetchMock = mock.method(globalThis, 'fetch', async () => { throw failure })
  await assert.rejects(apiFetch('/api/checkout', { method: 'POST' }), (error) => error === failure && !(error instanceof ClientApiError))
  assert.equal(fetchMock.mock.callCount(), 1)
})

test('abort stays unconfirmed and is not retried', async () => {
  const failure = new DOMException('Aborted', 'AbortError')
  const controller = new AbortController()
  const fetchMock = mock.method(globalThis, 'fetch', async () => { throw failure })
  await assert.rejects(apiFetch('/api/checkout', { method: 'POST', signal: controller.signal }), (error) => error === failure)
  assert.equal(fetchMock.mock.callCount(), 1)
  assert.equal(fetchMock.mock.calls[0].arguments[1].signal, controller.signal)
})

test('body read failure stays unconfirmed', async () => {
  const response = new Response('unused')
  mock.method(response, 'json', async () => { throw new TypeError('body stream lost') })
  withResponse(response)
  await assert.rejects(apiFetch('/api/example'), (error) => error instanceof client.UnconfirmedApiResponseError)
})

for (const [label, supplied] of [
  ['plain object', { 'X-Request-ID': 'stable-request', 'Content-Type': 'application/custom+json' }],
  ['Headers', new Headers({ 'X-Request-ID': 'stable-request', 'Content-Type': 'application/custom+json' })],
  ['tuple array', [['X-Request-ID', 'stable-request'], ['Content-Type', 'application/custom+json']]],
]) {
  test(`preserves ${label} request headers`, async () => {
    const fetchMock = withResponse(json({ ok: true, data: 1 }))
    await apiFetch('/api/example', { method: 'POST', headers: supplied, body: '{}' })
    const init = fetchMock.mock.calls[0].arguments[1]
    const headers = new Headers(init.headers)
    assert.equal(headers.get('x-request-id'), 'stable-request')
    assert.equal(headers.get('content-type'), 'application/custom+json')
    assert.equal(headers.has('0'), false)
    assert.equal(init.body, '{}')
  })
}

test('preserves Request headers when init.headers is omitted', async () => {
  const request = new Request('https://campuspay.test/api/example', { headers: { 'X-Request-ID': 'stable-request' } })
  const fetchMock = withResponse(json({ ok: true, data: 1 }))
  await apiFetch(request)
  const headers = new Headers(fetchMock.mock.calls[0].arguments[1].headers)
  assert.equal(headers.get('x-request-id'), 'stable-request')
  assert.equal(headers.get('content-type'), 'application/json')
  assert.equal(request.headers.has('content-type'), false, 'do not mutate caller headers')
})

test('explicit init headers override Request headers, using Fetch semantics', async () => {
  const request = new Request('https://campuspay.test/api/example', { headers: { 'X-Old': 'old' } })
  const fetchMock = withResponse(json({ ok: true, data: 1 }))
  await apiFetch(request, { headers: { 'X-New': 'new' } })
  const headers = new Headers(fetchMock.mock.calls[0].arguments[1].headers)
  assert.equal(headers.get('x-old'), null)
  assert.equal(headers.get('x-new'), 'new')
})

test('retains no-store and blocks redirected API requests', async () => {
  const fetchMock = withResponse(json({ ok: true, data: 1 }))
  await apiFetch('/api/example', { cache: 'force-cache', redirect: 'follow', credentials: 'same-origin' })
  const init = fetchMock.mock.calls[0].arguments[1]
  assert.equal(init.cache, 'no-store')
  assert.equal(init.redirect, 'error')
  assert.equal(init.credentials, 'same-origin')
})

test('does not accept an already redirected response as confirmation', async () => {
  const response = json({ ok: true, data: { audit_reference: 'not-trusted' } })
  Object.defineProperty(response, 'redirected', { value: true })
  withResponse(response)
  await assert.rejects(apiFetch('/api/example'), (error) => error instanceof client.UnconfirmedApiResponseError)
})
