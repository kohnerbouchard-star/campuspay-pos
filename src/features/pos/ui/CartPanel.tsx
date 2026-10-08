'use client'

import type { CouponQuote } from '@/features/coupons/domain'
import type { CartState } from '@/features/pos/cart'
import type { CartLine, CatalogProduct, TenderMode } from '@/features/pos/domain'
import { CartQuantity } from '@/features/pos/ui/CartQuantity'
import { CouponEntry } from '@/features/pos/ui/CouponEntry'
import { formatWon } from '@/lib/format/currency'
import { Icon } from '@/components/ui/Icon'

export function CartPanel({
  cart,canRedeem,
  products,
  subtotal,
  discount,
  total,
  coupon,
  cartLines,
  onCouponApply, couponChecking, couponError, couponBlocked,
  onCouponRemoved,
  onChange,
  onCheckout,
  tenderMode, cashEnabled, onTenderChange, busy,
}: {
  canRedeem:boolean
  cart: CartState
  products: CatalogProduct[]
  subtotal: number
  discount: number
  total: number
  coupon: { code: string; quote: CouponQuote } | null
  cartLines: CartLine[]
  onCouponApply(code: string): void
  couponChecking: boolean
  couponError: string | null
  couponBlocked: boolean
  onCouponRemoved(): void
  onChange(productId: string, delta: number, max: number): void
  onCheckout(): void
  tenderMode: TenderMode; cashEnabled: boolean; onTenderChange(mode: TenderMode): void; busy: boolean
}) {
  const lines = products.filter((product) => cart[product.id])
  const itemCount = Object.values(cart).reduce((sum, quantity) => sum + quantity, 0)
  return <aside id="pos-cart" tabIndex={-1} aria-labelledby="pos-cart-title" className="cart-panel pos-cart">
    <div className="cart-heading"><div><p className="eyebrow">Current sale</p><h2 id="pos-cart-title">Cart</h2></div><span className="cart-item-count"><Icon name="bag" size={17} />{itemCount} {itemCount === 1 ? 'item' : 'items'}</span></div>
    <div className="cart-lines">
      {lines.length === 0 && <div className="cart-empty"><span><Icon name="bag" size={28} /></span><strong>Ready for the next order</strong><p>Select an item to begin.</p></div>}
      {lines.map((product) => <div className="cart-line" key={product.id}>
        <div><strong>{product.name}</strong><small>{formatWon(product.selling_price_won)} each</small></div>
        <CartQuantity name={product.name} quantity={cart[product.id]} stock={product.sold_out ? 0 : product.stock_on_hand}
          onChange={quantity => onChange(product.id, quantity - cart[product.id], product.stock_on_hand)} />
      </div>)}
    </div>
    {canRedeem&&<CouponEntry
      empty={cartLines.length === 0}
      checking={couponChecking}
      error={couponError}
      applied={coupon}
      onApply={onCouponApply}
      onRemoved={onCouponRemoved}
    />}
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
    <button className="primary-action" disabled={!lines.length || busy || couponBlocked} onClick={onCheckout}><Icon name="card" size={19} />{busy ? 'Opening payment…' : couponBlocked ? 'Check or clear coupon before payment' : `Take payment · ${formatWon(total)}`}</button>
  </aside>
}
