'use client'

import { useEffect, useMemo, useState } from 'react'
import type { CouponQuote } from '@/features/coupons/domain'
import { addProduct, cartTotal, changeQuantity, toCartLines, type CartState } from '@/features/pos/cart'
import type { CatalogProduct, PaymentIntent, PaymentReceipt } from '@/features/pos/domain'
import { fetchCatalog, openPaymentIntent } from '@/features/pos/client'
import { ProductGrid } from '@/features/pos/ui/ProductGrid'
import { CartPanel } from '@/features/pos/ui/CartPanel'
import { PaymentDialog } from '@/features/pos/ui/PaymentDialog'
import { useInactivityLock } from '@/features/terminal/use-inactivity-lock'
import { formatWon } from '@/lib/format/currency'

export function POSScreen({ cashierName }: { cashierName: string }) {
  const [products, setProducts] = useState<CatalogProduct[]>([])
  const [cart, setCart] = useState<CartState>({})
  const [coupon, setCoupon] = useState<{ code: string; quote: CouponQuote } | null>(null)
  const [intent, setIntent] = useState<PaymentIntent | null>(null)
  const [receipt, setReceipt] = useState<PaymentReceipt | null>(null)
  const [error, setError] = useState<string | null>(null)
  const { remainingMs, warning } = useInactivityLock(20_000)
  const cartLines = useMemo(() => toCartLines(cart), [cart])
  const subtotal = useMemo(() => cartTotal(cart, products), [cart, products])
  const discount = coupon?.quote.discount_won ?? 0
  const total = coupon?.quote.total_won ?? subtotal

  async function load() {
    try { setProducts(await fetchCatalog()); setError(null) }
    catch (caught) { setError(caught instanceof Error ? caught.message : 'Catalog could not be loaded') }
  }
  useEffect(() => {
    let active = true
    void fetchCatalog().then(result => {
      if (active) { setProducts(result); setError(null) }
    }).catch((caught: unknown) => {
      if (active) setError(caught instanceof Error ? caught.message : 'Catalog could not be loaded')
    })
    return () => { active = false }
  }, [])

  function mutateCart(update: (current: CartState) => CartState) {
    setCoupon(null)
    setCart(update)
  }

  async function checkout() {
    try {
      setIntent(await openPaymentIntent(cartLines, coupon?.code ?? null))
      setError(null)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Checkout could not be opened')
      setCoupon(null)
    }
  }

  function completed(nextReceipt: PaymentReceipt) {
    setReceipt(nextReceipt)
    setIntent(null)
    setCart({})
    setCoupon(null)
    void load()
    window.setTimeout(() => setReceipt(null), 4_000)
  }

  return <main className="workspace">
    <header className="workspace-header">
      <div><p className="eyebrow">CampusPay register</p><h1>Point of sale</h1></div>
      <div className="session-chip"><span>{cashierName}</span><b>{Math.ceil(remainingMs / 1000)}s</b></div>
    </header>
    {warning && <div className="timeout-warning">Session locks in {Math.ceil(remainingMs / 1000)} seconds. Tap to continue.</div>}
    {error && <p className="error-message">{error}</p>}
    <div className="pos-layout">
      <ProductGrid products={products} onSelect={(product) => mutateCart((current) => addProduct(current, product))} />
      <CartPanel
        cart={cart}
        products={products}
        subtotal={subtotal}
        discount={discount}
        total={total}
        coupon={coupon}
        cartLines={cartLines}
        onCouponApplied={(code, quote) => setCoupon({ code, quote })}
        onCouponRemoved={() => setCoupon(null)}
        onChange={(id, delta, max) => mutateCart((current) => changeQuantity(current, id, delta, max))}
        onCheckout={() => void checkout()}
      />
    </div>
    {intent && <PaymentDialog intent={intent} onClose={() => setIntent(null)} onComplete={completed} />}
    {receipt && <div className="toast">
      <strong>Payment approved</strong>
      <span>{formatWon(receipt.total_won)} · Balance {formatWon(receipt.balance_after_won)}</span>
      {receipt.discount_won > 0 && <span>Coupon saved {formatWon(receipt.discount_won)}</span>}
    </div>}
  </main>
}
