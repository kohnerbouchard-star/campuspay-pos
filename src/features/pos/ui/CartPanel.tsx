'use client'

import type { CouponQuote } from '@/features/coupons/domain'
import type { CartState } from '@/features/pos/cart'
import type { CartLine, CatalogProduct, TenderMode } from '@/features/pos/domain'
import { CouponEntry } from '@/features/pos/ui/CouponEntry'
import { formatWon } from '@/lib/format/currency'
import { Icon } from '@/components/ui/Icon'

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
  tenderMode, cashEnabled, onTenderChange, busy,
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
  tenderMode: TenderMode; cashEnabled: boolean; onTenderChange(mode: TenderMode): void; busy: boolean
}) {
  const lines = products.filter((product) => cart[product.id])
  const itemCount = Object.values(cart).reduce((sum, quantity) => sum + quantity, 0)
  return <aside className="cart-panel pos-cart">
    <div className="cart-heading"><div><p className="eyebrow">Current sale</p><h2>Cart</h2></div><span className="cart-item-count"><Icon name="bag" size={17} />{itemCount} {itemCount === 1 ? 'item' : 'items'}</span></div>
    <div className="cart-lines">
      {lines.length === 0 && <div className="cart-empty"><span><Icon name="bag" size={28} /></span><strong>Ready for the next order</strong><p>Select an item to begin.</p></div>}
      {lines.map((product) => <div className="cart-line" key={product.id}>
        <div><strong>{product.name}</strong><small>{formatWon(product.selling_price_won)} each</small></div>
        <div className="quantity">
          <button onClick={() => onChange(product.id, -1, product.stock_on_hand)} aria-label={`Decrease ${product.name} quantity`}><Icon name="minus" size={16} /></button>
          <span aria-label={`${cart[product.id]} items`}>{cart[product.id]}</span>
          <button onClick={() => onChange(product.id, 1, product.stock_on_hand)} aria-label={`Increase ${product.name} quantity`}><Icon name="plus" size={16} /></button>
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
    <fieldset className="payment-methods"><legend>Payment method</legend>
      <div className="segmented-control">{(['WALLET', ...(cashEnabled ? ['CASH', 'SPLIT'] : [])] as TenderMode[]).map(mode => <button type="button" key={mode} aria-pressed={tenderMode === mode} onClick={() => onTenderChange(mode)}>{mode === 'WALLET' ? 'MICA Money' : mode === 'CASH' ? 'Cash' : 'Split'}</button>)}</div>
      {tenderMode === 'SPLIT' && <p className="muted">Scan the student’s card first, then choose their MICA Money contribution.</p>}
    </fieldset>
    <button className="primary-action" disabled={!lines.length || busy} onClick={onCheckout}><Icon name="card" size={19} />{busy ? 'Opening payment…' : `Take payment · ${formatWon(total)}`}</button>
  </aside>
}
