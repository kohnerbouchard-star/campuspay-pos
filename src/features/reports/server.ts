import 'server-only'
import type { SessionContext } from '@/features/auth/domain'
import { callApiRpc } from '@/lib/supabase/rpc'
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
  return callApiRpc('report_coupons', { p_session_id: session.session_id }, CouponReportSchema)
}
