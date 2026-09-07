import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '@/lib/api/errors'
const mocks = vi.hoisted(() => ({ authorize: vi.fn(), catalog: vi.fn(), locations: vi.fn() }))
vi.mock('@/features/store/server/session', () => ({ authorizeCustomerSession: mocks.authorize }))
vi.mock('@/features/store/server/orders', () => ({ storeCatalog: mocks.catalog, deliveryLocations: mocks.locations }))
import { GET as catalog } from '@/app/api/store/catalog/route'
import { GET as locations } from '@/app/api/store/locations/route'

beforeEach(() => vi.resetAllMocks())
describe('private catalog and delivery APIs', () => {
  it.each([['catalog', catalog], ['delivery locations', locations]] as const)('does not load %s before customer authorization', async (_, handler) => {
    mocks.authorize.mockRejectedValue(new ApiError(401, 'UNAUTHENTICATED', 'Authentication required'))
    const response = await handler()
    expect(response.status).toBe(401)
    expect(mocks.catalog).not.toHaveBeenCalled()
    expect(mocks.locations).not.toHaveBeenCalled()
  })
  it('passes the authorized customer session to the protected catalog operation', async () => {
    const session = { session_id: 'customer-session' }
    mocks.authorize.mockResolvedValue(session); mocks.catalog.mockResolvedValue([])
    expect((await catalog()).status).toBe(200)
    expect(mocks.catalog).toHaveBeenCalledWith(session)
  })
})
