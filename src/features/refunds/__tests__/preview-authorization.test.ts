import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '@/lib/api/errors'
const mocks = vi.hoisted(() => ({ authorize: vi.fn(), preview: vi.fn() }))
vi.mock('@/features/auth/server/session', () => ({ authorizeRequest: mocks.authorize }))
vi.mock('@/features/refunds/preview-server', () => ({ previewPartialRefund: mocks.preview }))
import { POST } from '@/app/api/refunds/preview/route'
const id = '70000000-0000-4000-8000-000000000001'
const input = { saleId: id, items: [{ sale_item_id: id, restock_quantity: 1, write_off_quantity: 0 }] }
const request = (body: unknown = input, origin = 'http://localhost') => new Request('http://localhost/api/refunds/preview', {
  method: 'POST', headers: { origin, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
})
beforeEach(() => vi.resetAllMocks())
describe('preview authorization precedes sale lookup', () => {
  it('rejects unauthenticated access without reading a sale', async () => {
    mocks.authorize.mockRejectedValue(new ApiError(401, 'UNAUTHENTICATED', 'Authentication required'))
    expect((await POST(request())).status).toBe(401); expect(mocks.preview).not.toHaveBeenCalled()
  })
  it('requires the existing financial reporting permission', async () => {
    const s = { session_id: id }; mocks.authorize.mockResolvedValue(s); mocks.preview.mockResolvedValue({ outcome: 'DISABLED' })
    const response = await POST(request())
    expect(mocks.authorize).toHaveBeenCalledWith('reports.sales'); expect(mocks.preview).toHaveBeenCalledWith(s, input)
    expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toBe('no-store')
  })
  it('rejects wrong-origin requests before authorization or calculation', async () => {
    expect((await POST(request(input, 'https://other.example'))).status).toBe(403)
    expect(mocks.authorize).not.toHaveBeenCalled(); expect(mocks.preview).not.toHaveBeenCalled()
  })
  it('rejects supplied money before calculation', async () => {
    mocks.authorize.mockResolvedValue({ session_id: id })
    expect((await POST(request({ ...input, refundWon: 1000 }))).status).toBe(400); expect(mocks.preview).not.toHaveBeenCalled()
  })
})
