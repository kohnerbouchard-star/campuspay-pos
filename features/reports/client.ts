import { apiFetch } from '@/lib/api/client'
import type { CouponReportRow } from '@/features/reports/domain'

export function fetchCouponReport() {
  return apiFetch<CouponReportRow[]>('/api/reports/coupons')
}
