import { authorizeRequest } from '@/features/auth/server/session'
import { QuoteCouponSchema } from '@/features/coupons/domain'
import { quoteCoupon } from '@/features/coupons/server'
import { failure, ok, parseJson } from '@/lib/api/response'

export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  try {
    const session = await authorizeRequest('coupons.redeem')
    const input = await parseJson(request, QuoteCouponSchema)
    return ok(await quoteCoupon(session, input.items, input.code))
  } catch (error) {
    return failure(error)
  }
}
