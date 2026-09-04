import { apiFetch } from '@/lib/api/client'
import type {
  CouponMutationResult,
  CouponQuote,
  CouponSummary,
  CreateCouponInput,
} from '@/features/coupons/domain'
import type { CartLine } from '@/features/pos/domain'

export function fetchCoupons() {
  return apiFetch<CouponSummary[]>('/api/coupons')
}

export function addCoupon(input: Omit<CreateCouponInput, 'idempotencyKey'>) {
  return apiFetch<CouponMutationResult>('/api/coupons', {
    method: 'POST',
    body: JSON.stringify({ ...input, idempotencyKey: crypto.randomUUID() }),
  })
}

export function disableCoupon(couponId: string, reason: string) {
  return apiFetch<CouponMutationResult>(`/api/coupons/${couponId}/deactivate`, {
    method: 'POST',
    body: JSON.stringify({ reason }),
  })
}

export function previewCoupon(items: CartLine[], code: string) {
  return apiFetch<CouponQuote>('/api/pos/coupons/quote', {
    method: 'POST',
    body: JSON.stringify({ items, code }),
  })
}
