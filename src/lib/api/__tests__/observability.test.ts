import { describe, expect, it, vi } from 'vitest'
import { withApiRoute } from '../route'
import { ok } from '../response'
import { logPoolFailure } from '../request-context'

describe('safe request correlation', () => {
  it('correlates a normalized failure without logging exception/body/query secrets', async () => {
    const logger = vi.spyOn(console, 'info').mockImplementation(() => undefined)
    try {
      const route = withApiRoute('/api/store/orders/[orderId]', async () => { throw new Error('postgres://user:secret@host/private raw-card and delivery note') })
      const response = await route(new Request('http://localhost/api/store/orders/secret?pin=secret'))
      const row = JSON.parse(String(logger.mock.calls[0][0]))
      expect(row).toMatchObject({ status: 500, code: 'INTERNAL_ERROR', surface: 'STORE', route: '/api/store/orders/[orderId]' })
      expect(row.request_id).toBe(response.headers.get('x-request-id'))
      expect(JSON.stringify(row)).not.toMatch(/postgres|secret|raw-card|delivery note/)
      expect(JSON.stringify(await response.json())).not.toContain('secret')
    } finally { logger.mockRestore() }
  })
  it('rejects cross-origin bodyless mutations before the handler runs', async () => {
    const handler = vi.fn(async () => ok({ changed: true }))
    const response = await withApiRoute('/api/auth/activity', handler)(new Request('http://localhost/api/auth/activity', { method: 'POST', headers: { origin: 'https://untrusted.example' } }))
    expect(response.status).toBe(403); expect(handler).not.toHaveBeenCalled()
  })
  it('emits only a fixed operational event on a pool failure', () => {
    const logger = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    try { logPoolFailure(); expect(JSON.parse(String(logger.mock.calls[0][0]))).toMatchObject({ event: 'database_pool_error', code: 'DATABASE_CONNECTION_ERROR' }) }
    finally { logger.mockRestore() }
  })
})
