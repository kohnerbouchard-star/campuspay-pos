import test, { afterEach, mock } from 'node:test'
import assert from 'node:assert/strict'
import { apiFetch, ClientApiError } from '../src/lib/api/client.ts'
import { authorizationRemainingMs, isStepUpAuthorization, isResetReceipt, securityActionFailure } from '../src/features/security/action-recovery.ts'

afterEach(() => mock.restoreAll())
const now = Date.parse('2026-10-02T02:00:00.000Z')
const failure = (code, status = 401) => ({ code, status, message: 'Safe server message' })

for (const code of ['UNAUTHENTICATED', 'SESSION_EXPIRED']) {
  for (const stage of ['authorize', 'reset']) {
    test(`${stage}: ${code} requires staff sign-in, not another approving PIN`, () => {
      const issue = securityActionFailure(stage, failure(code))
      assert.equal(issue.needsSignIn, true)
      assert.equal(issue.needsReview, false)
      assert.match(issue.message, /staff session ended/i)
    })
  }
}
for (const code of ['INVALID_PIN', 'RATE_LIMITED']) {
  test(`approval ${code} does not log out the requesting staff member`, () => {
    const issue = securityActionFailure('authorize', failure(code, code === 'RATE_LIMITED' ? 429 : 401))
    assert.equal(issue.needsSignIn, false)
    assert.equal(issue.needsReview, false)
    assert.match(issue.message, /approval was denied/i)
    assert.match(issue.message, /temporary lock/i)
  })
}
for (const stage of ['authorize', 'reset']) {
  test(`${stage}: forbidden response does not recommend bypassing approval`, () => {
    const issue = securityActionFailure(stage, failure('FORBIDDEN', 403))
    assert.match(issue.message, /staff site/)
    assert.match(issue.message, /fresh approval/)
    assert.equal(issue.needsReview, false)
  })
}
test('missing student credentials direct staff to the enrollment record', () => {
  assert.match(securityActionFailure('reset', failure('NOT_FOUND', 404)).message, /enrollment/)
})
test('confirmed validation failure keeps the safe server message', () => {
  const issue = securityActionFailure('reset', failure('BAD_REQUEST', 400))
  assert.equal(issue.message, 'Safe server message')
  assert.equal(issue.needsReview, false)
})
for (const cause of [null, failure('INTERNAL_ERROR', 500), failure('CONNECTION_NOT_CONFIGURED', 503), failure('UNAUTHENTICATED', 502)]) {
  test(`unconfirmed reset requires review: ${cause?.status ?? 'network'}`, () => {
    const issue = securityActionFailure('reset', cause)
    assert.equal(issue.needsReview, true)
    assert.equal(issue.needsSignIn, false)
    assert.match(issue.message, /may already have changed/)
  })
  test(`unconfirmed approval does not claim a reset was submitted: ${cause?.status ?? 'network'}`, () => {
    const issue = securityActionFailure('authorize', cause)
    assert.equal(issue.needsReview, false)
    assert.match(issue.message, /No reset was submitted/)
  })
}

for (const [name, response] of [
  ['HTML 404', () => new Response('<html>not found</html>', { status: 404 })],
  ['malformed 401', () => Response.json({ ok: false }, { status: 401 })],
  ['empty 204', () => new Response(null, { status: 204 })],
  ['server 500', () => Response.json({ ok: false, error: failure('INTERNAL_ERROR', 500) }, { status: 500 })],
]) {
  test(`real API parser -> security recovery preserves uncertainty for ${name}`, async () => {
    mock.method(globalThis, 'fetch', async () => response())
    await assert.rejects(apiFetch('/api/security/students/test/pin-reset', { method: 'POST' }), (error) => {
      const issue = securityActionFailure('reset', error instanceof ClientApiError ? error : null)
      assert.equal(issue.needsReview, true)
      assert.equal(issue.needsSignIn, false)
      return true
    })
  })
}
for (const [expiresAt, expected] of [
  ['not-a-date', 0], ['', 0], ['2026-10-02T01:59:59Z', 0],
  ['2026-10-02T02:00:00Z', 0], ['2026-10-02T02:00:10Z', 10_000],
  ['2026-10-02T02:01:00Z', 60_000], ['2099-01-01T00:00:00Z', 60_000],
]) {
  test(`approval expiry is bounded and fail-closed: ${expiresAt || 'empty'}`, () => {
    assert.equal(authorizationRemainingMs(expiresAt, now), expected)
  })
}
const validApproval = { authorizationToken: 'a'.repeat(43), expiresAt: '2026-10-02T02:01:00Z' }
test('accepts a complete current approval', () => assert.equal(isStepUpAuthorization(validApproval, now), true))
for (const value of [null, {}, [], 'approved', { ...validApproval, authorizationToken: '' }, { ...validApproval, authorizationToken: ' '.repeat(32) }, { ...validApproval, expiresAt: 'bad' }, { ...validApproval, expiresAt: '2026-10-02T02:00:00Z' }]) {
  test(`does not display an invalid approval as authorized: ${JSON.stringify(value)}`, () => {
    assert.equal(isStepUpAuthorization(value, now), false)
  })
}
const validReceipt = { audit_reference: 'AUD-TEST', completed_at: '2026-10-02T02:00:30Z' }
test('accepts a complete reset receipt', () => assert.equal(isResetReceipt(validReceipt), true))
for (const value of [null, {}, [], 'done', { ...validReceipt, audit_reference: '' }, { ...validReceipt, audit_reference: ' ' }, { ...validReceipt, completed_at: 'bad' }, { audit_reference: 'AUD-TEST' }]) {
  test(`does not display an invalid receipt as success: ${JSON.stringify(value)}`, () => {
    assert.equal(isResetReceipt(value), false)
  })
}
