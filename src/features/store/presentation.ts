import { BUSINESS_TIMEZONE } from '@/lib/format/business-time'
import { ClientApiError } from '@/lib/api/client'
import type { CustomerProfile, CustomerSession } from '@/features/store/domain'

export const ORDER_STEPS = ['PLACED', 'PICKING', 'READY', 'OUT_FOR_DELIVERY', 'DELIVERED'] as const

export function orderStatusLabel(status: string): string {
  const labels: Record<string, string> = { PLACED: 'Order placed', PICKING: 'Picking items', READY: 'Ready', OUT_FOR_DELIVERY: 'Out for delivery', DELIVERED: 'Delivered', CANCELLED: 'Cancelled' }
  return labels[status] ?? 'Updating status'
}

export function customerProfile(session: CustomerSession): CustomerProfile {
  return { student_id: session.student_id, display_name: session.display_name, balance_won: session.balance_won, debt_won: session.debt_won, expires_at: session.expires_at }
}

export function isCustomerSessionError(error: unknown): boolean {
  return error instanceof ClientApiError && error.status === 401
}

export function storeErrorMessage(error: unknown, fallback = 'We couldn’t complete that request. Please try again.'): string {
  if (!(error instanceof ClientApiError)) return 'We couldn’t connect to MICA Money. Check your connection and try again.'
  const messages: Record<string, string> = {
    WALLET_LIMIT: 'This order would take your MICA Money balance below −₩15,000. Remove an item or visit E202 to add funds.',
    INVENTORY_SHORTAGE: 'An item is no longer available in that quantity. Refresh the store and adjust your cart.',
    COUPON_INVALID: 'We couldn’t find that coupon. Check the code and try again.',
    COUPON_EXPIRED: 'This coupon isn’t active right now.',
    COUPON_MINIMUM: 'Your order doesn’t meet this coupon’s minimum purchase.',
    COUPON_LIMIT: 'This coupon has reached its use limit.',
    COUPON_UNAVAILABLE: 'This coupon is no longer available.',
    COUPON_STUDENT_LIMIT: 'You’ve already used this coupon the maximum number of times.',
    CONFLICT: 'Your order has changed since the review. Refresh the store and review the updated total before trying again.',
    RATE_LIMITED: 'Sign-in is temporarily paused. Wait a few minutes and try again, or visit E202 for help.',
    UNAUTHENTICATED: 'Your session has ended. Sign in to continue.',
    SESSION_EXPIRED: 'Your session has ended. Sign in to continue.',
  }
  return messages[error.code] ?? fallback
}

export function orderTime(value: string): string {
  return new Intl.DateTimeFormat('en-GB', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: BUSINESS_TIMEZONE }).format(new Date(value))
}
