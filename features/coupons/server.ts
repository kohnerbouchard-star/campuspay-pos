import 'server-only'
import { z } from 'zod'
import type { SessionContext } from '@/features/auth/domain'
import type { CartLine } from '@/features/pos/domain'
import {
  CouponListSchema,
  CouponMutationResultSchema,
  CouponQuoteSchema,
  type CreateCouponInput,
} from '@/features/coupons/domain'
import { callApiRpc } from '@/lib/supabase/rpc'
import { fingerprintCouponCode, maskCouponCode } from '@/lib/crypto/coupon-code'

export function listCoupons(session: SessionContext) {
  return callApiRpc('list_coupons', { p_session_id: session.session_id }, CouponListSchema)
}

export function createCoupon(session: SessionContext, input: CreateCouponInput) {
  return callApiRpc('create_coupon', {
    p_session_id: session.session_id,
    p_name: input.name,
    p_code_fingerprint: fingerprintCouponCode(input.code),
    p_code_masked: maskCouponCode(input.code),
    p_discount_type: input.discountType,
    p_fixed_amount_won: input.discountType === 'FIXED' ? input.fixedAmountWon : null,
    p_percentage_bps: input.discountType === 'PERCENTAGE' ? input.percentageBps : null,
    p_minimum_subtotal_won: input.minimumSubtotalWon,
    p_max_discount_won: input.maxDiscountWon,
    p_total_redemption_limit: input.totalRedemptionLimit,
    p_per_student_limit: input.perStudentLimit,
    p_starts_at: input.startsAt,
    p_ends_at: input.endsAt,
    p_idempotency_key: input.idempotencyKey,
  }, z.array(CouponMutationResultSchema).length(1).transform(([row]) => row))
}

export function deactivateCoupon(session: SessionContext, couponId: string, reason: string) {
  return callApiRpc('deactivate_coupon', {
    p_session_id: session.session_id,
    p_coupon_id: couponId,
    p_reason: reason,
  }, z.array(CouponMutationResultSchema).length(1).transform(([row]) => row))
}

export function quoteCoupon(session: SessionContext, items: CartLine[], code: string) {
  return callApiRpc('quote_coupon', {
    p_session_id: session.session_id,
    p_items: items,
    p_coupon_code_fingerprint: fingerprintCouponCode(code),
  }, z.array(CouponQuoteSchema).length(1).transform(([row]) => row))
}
