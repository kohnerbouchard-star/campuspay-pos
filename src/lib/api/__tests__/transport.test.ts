import { afterEach, describe, expect, it, vi } from 'vitest'
import { apiFetch, ClientApiError } from '../client'
afterEach(() => vi.unstubAllGlobals())
describe('API transport contract', () => {
  it.each([
    [404, 'text/plain', 'The deployment could not be found'],
    [502, 'text/html', '<html>upstream secret must not be shown</html>'],
    [200, 'application/json', '{'],
    [500, 'application/json', '{"message":"upstream secret must not be shown"}'],
    [200, 'application/json', 'null'],
    [200, 'application/json', '{"ok":false,"error":{"code":"BAD_REQUEST","message":"invalid"}}'],
  ])('preserves unknown outcome for %s %s', async (status, contentType, body) => {
    const fetch = vi.fn().mockResolvedValue(new Response(body, { status: Number(status), headers: { 'Content-Type': String(contentType), 'X-Request-ID': '01234567-1234-4234-8234-0123456789ab' } }))
    vi.stubGlobal('fetch', fetch)
    try { await apiFetch('/api/operation', { method: 'POST' }); expect.fail('Expected safe error') }
    catch (error) {
      expect(error).toBeInstanceOf(ClientApiError)
      expect(error).toMatchObject({ code: 'INVALID_RESPONSE', status, outcome: 'unknown', requestId: '01234567-1234-4234-8234-0123456789ab' })
      expect((error as Error).message).not.toContain('upstream secret')
    }
    expect(fetch).toHaveBeenCalledTimes(1)
  })
  it('does not treat a bare 204 as a confirmed mutation', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 204 })))
    await expect(apiFetch('/api/operation')).rejects.toMatchObject({ status: 204, outcome: 'unknown' })
  })
  it('normalizes network failures without retry or exception leakage', async () => {
    const fetch = vi.fn().mockRejectedValue(new TypeError('private diagnostic'))
    vi.stubGlobal('fetch', fetch)
    await expect(apiFetch('/api/operation', { method: 'POST' })).rejects.toMatchObject({ code: 'NETWORK_ERROR', status: 0, outcome: 'unknown' })
    expect(fetch).toHaveBeenCalledTimes(1)
  })
  it('keeps legitimate success and application error envelopes', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(Response.json({ ok: true, data: { posted: true } }))
      .mockResolvedValueOnce(Response.json({ ok: true }))
      .mockResolvedValueOnce(Response.json({ ok: false, error: { code: 'INVALID_PIN', message: 'PIN verification failed' } }, { status: 401 })))
    await expect(apiFetch('/api/operation')).resolves.toEqual({ posted: true })
    await expect(apiFetch('/api/closed-recovery')).resolves.toBeUndefined()
    await expect(apiFetch('/api/operation')).rejects.toMatchObject({ code: 'INVALID_PIN', status: 401, outcome: 'rejected' })
  })
  it('preserves Headers objects and discards untrusted request identifiers', async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json({ ok: false, error: { code: 'FORBIDDEN', message: 'Denied' } }, { status: 403, headers: { 'X-Request-ID': 'not-a-correlation-id' } }))
    vi.stubGlobal('fetch', fetch)
    await expect(apiFetch('/api/operation', { headers: new Headers({ Accept: 'application/json' }) })).rejects.toMatchObject({ requestId: null })
    expect(fetch.mock.calls[0][1].headers.get('Accept')).toBe('application/json')
  })
})
