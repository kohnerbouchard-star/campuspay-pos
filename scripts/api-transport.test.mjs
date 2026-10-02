import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { test } from 'node:test'
const require = createRequire(import.meta.url)
let ts
try { ts = require('typescript') } catch { ts = require('/opt/nvm/versions/node/v22.16.0/lib/node_modules/typescript/lib/typescript.js') }
const code = ts.transpileModule(readFileSync(new URL('../src/lib/api/client.ts', import.meta.url), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText
const { apiFetch, ClientApiError, TransportApiError } = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`)
const cases = [
  [404, 'The deployment could not be found'], [502, '<html>upstream failure</html>'],
  [200, '{broken'], [200, 'null'], [200, '[]'], [200, '{}'],
  [401, '{"ok":false}'], [401, '{"ok":false,"error":null}'],
  [401, '{"ok":false,"error":{"code":12,"message":"no"}}'],
  [401, '{"ok":false,"error":{"code":"ERROR","message":false}}'],
  [200, '{"ok":false,"error":{"code":"ERROR","message":"no"}}'],
  [500, '{"ok":true,"data":{"receipt":"not authoritative"}}'],
]
for (const [status, body] of cases) test(`HTTP ${status} malformed envelope stays uncertain: ${body}`, async t => {
  t.mock.method(globalThis, 'fetch', async () => new Response(body, { status, headers: { 'x-request-id': 'request-123' } }))
  await assert.rejects(() => apiFetch('/test', { method: 'POST' }), e => e instanceof TransportApiError && !(e instanceof ClientApiError) && e.status === status && e.requestId === 'request-123' && !e.message.includes('<html>'))
})
test('network interruption never becomes a definitive application rejection', async t => {
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('sensitive transport information') })
  await assert.rejects(() => apiFetch('/test'), e => e instanceof TransportApiError && e.status === 0 && !e.message.includes('sensitive'))
})
test('a valid 401 error preserves its safe code and HTTP status', async t => {
  t.mock.method(globalThis, 'fetch', async () => Response.json({ ok: false, error: { code: 'SESSION_EXPIRED', message: 'Sign in again' } }, { status: 401 }))
  await assert.rejects(() => apiFetch('/test'), e => e instanceof ClientApiError && e.status === 401 && e.code === 'SESSION_EXPIRED')
})
test('successful payloads and Headers instances remain supported', async t => {
  t.mock.method(globalThis, 'fetch', async (input, init) => {
    assert.equal(init.headers.get('X-Test'), 'preserved'); assert.equal(init.cache, 'no-store')
    return Response.json({ ok: true, data: { reference_number: 'test' } })
  })
  assert.deepEqual(await apiFetch('/test', { headers: new Headers({ 'X-Test': 'preserved' }) }), { reference_number: 'test' })
})
