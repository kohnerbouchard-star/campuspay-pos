import { withApiRoute } from '@/lib/api/route'
import { authorizeRequest } from '@/features/auth/server/session'
import { CreateCouponSchema } from '@/features/coupons/domain'
import { createCoupon, listCoupons } from '@/features/coupons/server'
import { failure, ok, parseJson } from '@/lib/api/response'

export const dynamic = 'force-dynamic'

export const GET = withApiRoute('/api/coupons', async () => {
  try {
    const session = await authorizeRequest('coupons.manage')
    return ok(await listCoupons(session))
  } catch (error) {
    return failure(error)
  }
})

export const POST = withApiRoute('/api/coupons', async (request: Request) => {
  try {
    const session = await authorizeRequest('coupons.manage')
    const input = await parseJson(request, CreateCouponSchema)
    return ok(await createCoupon(session, input), { status: 201 })
  } catch (error) {
    return failure(error)
  }
})
