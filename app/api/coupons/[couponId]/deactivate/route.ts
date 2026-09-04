import { z } from 'zod'
import { authorizeRequest } from '@/features/auth/server/session'
import { DeactivateCouponSchema } from '@/features/coupons/domain'
import { deactivateCoupon } from '@/features/coupons/server'
import { failure, ok, parseJson } from '@/lib/api/response'

export const dynamic = 'force-dynamic'

export async function POST(request: Request, context: { params: Promise<{ couponId: string }> }) {
  try {
    const session = await authorizeRequest('coupons.manage')
    const { couponId } = await context.params
    z.string().uuid().parse(couponId)
    const input = await parseJson(request, DeactivateCouponSchema)
    return ok(await deactivateCoupon(session, couponId, input.reason))
  } catch (error) {
    return failure(error)
  }
}
