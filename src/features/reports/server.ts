import 'server-only'
import { z } from 'zod'
import type { SessionContext } from '@/features/auth/domain'
import { callApiRpc } from '@/lib/db/rpc'
import {
  SalesReportSchema,
  InventoryReportSchema,
  WalletReportSchema,
  CouponReportSchema,
} from '@/features/reports/domain'

export function salesReport(session: SessionContext, from?: string, to?: string) {
  return callApiRpc('report_sales', {
    p_session_id: session.session_id,
    p_from: from ?? null,
    p_to: to ?? null,
  }, SalesReportSchema)
}

export function inventoryReport(session: SessionContext) {
  return callApiRpc('report_inventory', { p_session_id: session.session_id }, InventoryReportSchema)
}

export function walletReport(session: SessionContext) {
  return callApiRpc('report_wallets', { p_session_id: session.session_id }, WalletReportSchema)
}

export function couponReport(session: SessionContext) {
  return callApiRpc('report_coupons', { p_session_id: session.session_id }, z.array(z.object({coupon_name:z.string(),code_masked:z.string(),redemption_count:z.number(),discount_won:z.number(),net_sales_won:z.number(),last_redeemed_at:z.string().nullable()})).transform(rows => CouponReportSchema.parse(rows.map(r => ({...r,discount_given_won:r.discount_won,sales_revenue_won:r.net_sales_won})))))
}
