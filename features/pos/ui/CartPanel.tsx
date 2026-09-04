'use client'

import type { CouponQuote } from '@/features/coupons/domain'
import type { CartState } from '@/features/pos/cart'
import type { CartLine, CatalogProduct } from '@/features/pos/domain'
import { CouponEntry } from '@/features/pos/ui/CouponEntry'
import { formatWon } from '@/lib/format/currency'

export function CartPanel({
  cart,
  products,
  subtotal,
  discount,
  total,
  coupon,
  cartLines,
  onCouponApplied,
  onCouponRemoved,
  onChange,
  onCheckout,
}: {
  cart: CartState
  products: CatalogProduct[]
  subtotal: number
  discount: number
  total: number
  coupon: { code: string; quote: CouponQuote } | null
  cartLines: CartLine[]
  onCouponApplied(code: string, quote: CouponQuote): void
  onCouponRemoved(): void
  onChange(productId: string, delta: number, max: number): void
  onCheckout(): void
}) {
  const lines = products.filter((product) => cart[product.id])
  return <aside className="cart-panel">
    <div><p className="eyebrow">Current order</p><h2>Cart</h2></div>
    <div className="cart-lines">
      {lines.length === 0 && <p className="muted">Select an item to begin.</p>}
      {lines.map((product) => <div className="cart-line" key={product.id}>
        <div><strong>{product.name}</strong><small>{formatWon(product.selling_price_won)} each</small></div>
        <div className="quantity">
          <button onClick={() => onChange(product.id, -1, product.stock_on_hand)} aria-label="Decrease">−</button>
          <span>{cart[product.id]}</span>
          <button onClick={() => onChange(product.id, 1, product.stock_on_hand)} aria-label="Increase">+</button>
        </div>
      </div>)}
    </div>
    <CouponEntry
      items={cartLines}
      applied={coupon}
      onApplied={onCouponApplied}
      onRemoved={onCouponRemoved}
    />
    <div className="order-summary">
      {discount > 0 && <>
        <div><span>Subtotal</span><b>{formatWon(subtotal)}</b></div>
        <div className="discount-line"><span>Coupon</span><b>−{formatWon(discount)}</b></div>
      </>}
      <div className="cart-total"><span>Total</span><strong>{formatWon(total)}</strong></div>
    </div>
    <button className="primary-action" disabled={!lines.length} onClick={onCheckout}>Take payment</button>
  </aside>
}
