import test, { afterEach, mock } from 'node:test'
import assert from 'node:assert/strict'
import { validationFeedback } from '../src/lib/api/validation.ts'
import { apiFetch, ClientApiError } from '../src/lib/api/client.ts'
const json = (value, status = 200) => Response.json(value, { status })
const withResponse = response => mock.method(globalThis, 'fetch', async () => response)
afterEach(() => mock.restoreAll())
// Dependency-free format tests; real Zod and parseJson are tested in Vitest.
const node = (type, extra = {}) => ({ _zod: { def: { type, ...extra } } })
const schema = node('object', { shape: { eventName: node('string'), endsAt: node('nullable', { innerType: node('string') }), lines: node('array', { element: node('object', { shape: { quantity: node('number'), productId: node('string') } }) }) } })
const issue = (code, path, extra = {}) => ({ code, path, message: 'SECRET_DO_NOT_ECHO', input: 'secret pin', ...extra })
test('nested request fields and numeric constraints are specific', () => {
  const result = validationFeedback(schema, [issue('too_small', ['lines', 0, 'quantity'], { minimum: 1, inclusive: true, origin: 'number' })])
  assert.deepEqual(result.fieldErrors, [{ field: 'lines.0.quantity', message: 'Enter a number at least 1.' }])
  assert.match(result.message, /item 1.*quantity/)
})
for (const path of [['unexpected_secret'], ['lines', 0, 'secret'], ['constructor'], ['__proto__'], ['lines', -1, 'quantity'], ['lines', 0.2, 'quantity'], ['lines', 1000001, 'quantity'], [Symbol('secret')]]) {
  test(`unknown or unsafe path is redacted: ${path.map(String).join(".")}`, () => {
    const result = validationFeedback(schema, [issue('invalid_type', path, { expected: 'number' })])
    assert.equal(result.fieldErrors[0].field, 'request')
    assert.doesNotMatch(JSON.stringify(result), /secret|SECRET/)
  })
}
test('arbitrary issue messages, values, regex and extra metadata are omitted', () => {
  const result = validationFeedback(schema, [issue('invalid_format', ['eventName'], { format: 'regex', pattern: 'secret', values: ['secret'], keys: ['secret'] })])
  assert.deepEqual(result.fieldErrors, [{ field: 'eventName', message: 'Use the required format.' }])
  assert.doesNotMatch(JSON.stringify(result), /secret|SECRET|pattern|values|input|keys/)
})
test('custom messages require explicit code-owned allowlisting', () => {
  assert.doesNotMatch(validationFeedback(schema, [issue('custom', ['endsAt'])]).message, /SECRET/)
  const message = 'Choose a future end time within 24 hours.'
  assert.match(validationFeedback(schema, [issue('custom', ['endsAt'], { message })], { allowedCustomMessages: [message] }).message, /24 hours/)
})
for (const type of ['optional', 'nullable', 'default', 'prefault', 'catch', 'readonly', 'nonoptional']) {
  test(`declared field under ${type} wrapper`, () => assert.equal(validationFeedback(node(type, { innerType: schema }), [issue('custom', ['eventName'])]).fieldErrors[0].field, 'eventName'))
}
test('input-side pipes and unions preserve declared fields', () => {
  for (const wrapped of [node('pipe', { in: schema }), node('union', { options: [node('string'), schema] })]) assert.equal(validationFeedback(wrapped, [issue('custom', ['eventName'])]).fieldErrors[0].field, 'eventName')
})
test('dynamic records and unknown schema kinds redact field names', () => {
  for (const type of ['record', 'future-type']) assert.equal(validationFeedback(node(type), [issue('custom', ['SECRET'])]).fieldErrors[0].field, 'request')
})
test('feedback is deduplicated and bounded', () => {
  const issues = Array.from({ length: 100 }, (_, i) => issue('custom', ['lines', i, 'quantity']))
  const result = validationFeedback(schema, [issues[0], ...issues])
  assert.equal(result.fieldErrors.length, 8)
  assert.equal(new Set(result.fieldErrors.map(error => error.field)).size, 8)
  assert.ok(result.message.length <= 950)
})
test('unknown parser and no-issue failures remain generic', () => {
  assert.equal(validationFeedback({}, [issue('custom', ['eventName'])]).fieldErrors[0].field, 'request')
  assert.equal(validationFeedback(schema, []).message, 'Request validation failed')
})

test('keeps safe field errors on a 400 without changing rejection classification', async () => {
  withResponse(json({ ok: false, error: { code: 'BAD_REQUEST', message: 'Quantity: enter at least 1.', details: { fieldErrors: [{ field: 'lines.0.quantity', message: 'Enter a number at least 1.', input: 'SECRET' }] } } }, 400))
  await assert.rejects(apiFetch('/api/inventory/receipts', { method: 'POST' }), error => {
    assert.ok(error instanceof ClientApiError)
    assert.equal(error.status, 400)
    assert.deepEqual(error.fieldErrors, [{ field: 'lines.0.quantity', message: 'Enter a number at least 1.' }])
    assert.equal(JSON.stringify(error.fieldErrors).includes('SECRET'), false)
    return true
  })
})
for (const details of [null, { fieldErrors: 'bad' }, { fieldErrors: [{ field: '__proto__.polluted', message: 'bad' }] }, { fieldErrors: [{ field: 'pin', message: '<html>unsafe</html>' }] }, { fieldErrors: [{ field: 'pin', message: ' ' }] }]) {
  test('ignores malformed optional validation metadata', async () => {
    withResponse(json({ ok: false, error: { code: 'BAD_REQUEST', message: 'Safe rejection', details } }, 400))
    await assert.rejects(apiFetch('/api/example'), error => error instanceof ClientApiError && error.fieldErrors.length === 0)
  })
}
for (const [code, status] of [['BAD_REQUEST', 500], ['INVALID_PIN', 401], ['CONFLICT', 409]]) {
  test(`does not treat ${code}/${status} as field validation`, async () => {
    withResponse(json({ ok: false, error: { code, message: 'Safe rejection', details: { fieldErrors: [{ field: 'pin', message: 'Unrelated metadata' }] } } }, status))
    await assert.rejects(apiFetch('/api/example'), error => error instanceof ClientApiError && error.status === status && error.fieldErrors.length === 0)
  })
}
