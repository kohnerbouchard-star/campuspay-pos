import type { CouponQuote } from '@/features/coupons/domain'
import type { CartState } from '@/features/pos/cart'

export type CouponRequest = { id: string; revision: number; code: string }
export type CouponCalculation =
  | { status: 'idle' }
  | { status: 'pending'; request: CouponRequest }
  | { status: 'ready'; request: CouponRequest; quote: CouponQuote }
  | { status: 'error'; request: CouponRequest; message: string }
export type CheckoutState = { cart: CartState; revision: number; coupon: CouponCalculation }
export const initialCheckoutState: CheckoutState = { cart: {}, revision: 0, coupon: { status: 'idle' } }
export type CheckoutAction =
  | { type: 'cart'; update(cart: CartState): CartState; invalidate?: boolean }
  | { type: 'coupon-start'; request: CouponRequest }
  | { type: 'coupon-result'; request: CouponRequest; quote: CouponQuote }
  | { type: 'coupon-error'; request: CouponRequest; message: string }
  | { type: 'coupon-clear' }

/** One reducer owns cart revisions and coupon results. An A -> B -> A cart is
 * still a new revision; replacing/clearing a coupon invalidates its request ID. */
export function checkoutReducer(state: CheckoutState, action: CheckoutAction): CheckoutState {
  if (action.type === 'cart') {
    const cart = action.update(state.cart)
    return cart === state.cart && !action.invalidate ? state
      : { cart, revision: state.revision + 1, coupon: { status: 'idle' } }
  }
  if (action.type === 'coupon-clear') return { ...state, coupon: { status: 'idle' } }
  if (action.request.revision !== state.revision) return state
  if (action.type === 'coupon-start') return { ...state, coupon: { status: 'pending', request: action.request } }
  if (state.coupon.status !== 'pending' || state.coupon.request.id !== action.request.id) return state
  return { ...state, coupon: action.type === 'coupon-result'
    ? { status: 'ready', request: action.request, quote: action.quote }
    : { status: 'error', request: action.request, message: action.message } }
}

export function couponBlocksCheckout(coupon: CouponCalculation): boolean {
  return coupon.status === 'pending' || coupon.status === 'error'
}
