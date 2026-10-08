'use client'

import './pos.css'

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { previewCoupon } from '@/features/coupons/client'
import { checkoutReducer, couponBlocksCheckout, initialCheckoutState } from '@/features/pos/checkout-state'
import { confirmedReceipt } from '@/features/pos/confirmed-receipt'
import { addProduct, cartTotal, changeQuantity, reconcileCart, toCartLines, type CartState } from '@/features/pos/cart'
import type { CatalogProduct, PaymentIntent, PaymentReceipt, PaymentPolicy, TenderMode } from '@/features/pos/domain'
import { fetchCatalog, fetchPaymentPolicy, openPaymentIntent, recoverPaymentIntent } from '@/features/pos/client'
import { ProductGrid } from '@/features/pos/ui/ProductGrid'
import { CartPanel } from '@/features/pos/ui/CartPanel'
import { PaymentDialog } from '@/features/pos/ui/PaymentDialog'
import { ReceiptDialog, type ReceiptLine } from '@/features/pos/ui/ReceiptDialog'
import { PaymentStatus } from '@/features/pos/ui/PaymentStatus'
import { PAYMENT_RESULT_GRACE_MS } from '@/features/terminal/inactivity'
import { useInactivityLock } from '@/features/terminal/use-inactivity-lock'
import { forgetPendingPayment, readPendingPayment } from '@/features/pos/pending-payment'
import { ErrorState, LoadingState } from '@/components/ui/Feedback'
import { Icon } from '@/components/ui/Icon'

export function POSScreen({ cashierName,canCheckout,canRedeem,canReadRefunds=false }: { cashierName: string;canCheckout:boolean;canRedeem:boolean;canReadRefunds?:boolean }) {
  const [products, setProducts] = useState<CatalogProduct[]>([])
  const [checkoutState, dispatch] = useReducer(checkoutReducer, initialCheckoutState)
  const { cart } = checkoutState
  const calculation = checkoutState.coupon
  const coupon = calculation.status === 'ready' ? { code: calculation.request.code, quote: calculation.quote } : null
  const couponBlocked = couponBlocksCheckout(calculation)
  const [intent, setIntent] = useState<PaymentIntent | null>(null)
  const [receipt, setReceipt] = useState<PaymentReceipt | null>(null)
  const [receiptItems, setReceiptItems] = useState<ReceiptLine[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [recoveryBlocked, setRecoveryBlocked] = useState(false)
  const [policy, setPolicy] = useState<PaymentPolicy | null>(null)
  const [tenderMode, setTenderMode] = useState<TenderMode>('WALLET')
  const pending = useRef(false)
  const checkoutKey = useRef<string | null>(null)
  const { remainingMs, warning, noteActivity } = useInactivityLock(intent ? { key: intent.intent_id, until: Date.parse(intent.expires_at) + PAYMENT_RESULT_GRACE_MS } : receipt ? { key: receipt.sale_id } : busy || loading || recoveryBlocked ? { key: 'payment-recovery' } : null)
  const cartLines = useMemo(() => toCartLines(cart), [cart])
  const itemCount = cartLines.reduce((count, line) => count + line.quantity, 0)
  const subtotal = useMemo(() => cartTotal(cart, products), [cart, products])
  const discount = coupon?.quote.discount_won ?? 0
  const total = coupon?.quote.total_won ?? subtotal

  const recoverPending = useCallback(async () => {
    if(!canCheckout)return
    const id = readPendingPayment()
    if (!id) return
    try {
      const result = confirmedReceipt(await recoverPaymentIntent(id))
      forgetPendingPayment(); setRecoveryBlocked(false)
      if (result?.receipt) { setReceipt(result.receipt); setReceiptItems(result.items) }
    } catch {
      setRecoveryBlocked(true)
      throw new Error('A previous payment still needs a confirmed result. Sign in again on this register or retry recovery before starting another sale.')
    }
  }, [canCheckout])

  async function load() {
    setLoading(true)
    try { const [catalog, paymentPolicy] = await Promise.all([fetchCatalog(), fetchPaymentPolicy()]); setProducts(catalog); dispatch({ type: 'cart', update: current => reconcileCart(current, catalog), invalidate: true }); setPolicy(paymentPolicy); await recoverPending(); setError(null) }
    catch (caught) { setError(caught instanceof Error ? caught.message : 'Catalog could not be loaded') }
    finally { setLoading(false) }
  }
  useEffect(() => {
    let active = true
    void Promise.all([fetchCatalog(), fetchPaymentPolicy()]).then(async ([catalog, paymentPolicy]) => {
      if (active) { setProducts(catalog); dispatch({ type: 'cart', update: current => reconcileCart(current, catalog), invalidate: true }); setPolicy(paymentPolicy); await recoverPending(); setError(null) }
    }).catch((caught: unknown) => {
      if (active) setError(caught instanceof Error ? caught.message : 'Catalog could not be loaded')
    }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [recoverPending])

  function mutateCart(update: (current: CartState) => CartState) {
    checkoutKey.current = null; dispatch({ type: 'cart', update })
  }
  async function applyCoupon(code: string) {
    if (!canRedeem || pending.current || !cartLines.length) return
    checkoutKey.current = null
    const request = { id: crypto.randomUUID(), revision: checkoutState.revision, code }
    dispatch({ type: 'coupon-start', request })
    try { dispatch({ type: 'coupon-result', request, quote: await previewCoupon(cartLines, code) }) }
    catch (caught) { dispatch({ type: 'coupon-error', request, message: caught instanceof Error ? caught.message : 'Coupon could not be checked.' }) }
  }
  async function checkout() {
    if (!canCheckout || pending.current || couponBlocked || recoveryBlocked || loading || error || !cartLines.length) return
    pending.current = true; setBusy(true)
    checkoutKey.current ??= crypto.randomUUID()
    try {
      setIntent(await openPaymentIntent(cartLines, coupon?.code ?? null, tenderMode, null, checkoutKey.current))
      setReceiptItems([])
      setError(null)
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Checkout could not be opened') }
    finally { pending.current = false; setBusy(false) }
  }
  function completed(nextReceipt: PaymentReceipt, recoveredItems: ReceiptLine[]) {
    setReceiptItems(recoveredItems)
    setReceipt(nextReceipt); setIntent(null); dispatch({ type: 'cart', update: () => ({}) }); setTenderMode('WALLET'); checkoutKey.current = null; void load()
  }
  const policyChanged = useCallback((next: PaymentPolicy) => { setPolicy(next); if (!next.cash_enabled) { setTenderMode('WALLET'); checkoutKey.current = null } }, [])

  useEffect(() => {
    let active = true
    const refresh = () => void fetchPaymentPolicy().then(next => { if (active) policyChanged(next) }).catch((caught: unknown) => { if (active) setError(caught instanceof Error ? caught.message : 'Payment status could not be checked.') })
    const timer = window.setInterval(refresh, 15_000)
    const expiry = policy?.cash_enabled && policy.ends_at ? window.setTimeout(() => {
      policyChanged({ ...policy, cash_enabled: false, event_status: 'EXPIRED' }); refresh()
    }, Math.max(0, Date.parse(policy.ends_at) - Date.now())) : undefined
    return () => { active = false; window.clearInterval(timer); window.clearTimeout(expiry) }
  }, [policy, policyChanged])

  return <main className="workspace">
    <header className="workspace-header">
      <div><p className="eyebrow">MICA Money · Staff register</p><h1>Point of sale</h1><p className="muted">Find an item, build the sale, and take payment.</p></div>
      <div className="session-chip"><Icon name="register" size={19} /><span className="session-details"><span>{cashierName}</span><small>{policy?.terminal_label ?? 'Register'}</small></span>{policy?.cash_enabled && <b>Cash enabled · {policy.event_name}</b>}</div>
    </header>
    {warning && <div className="timeout-warning" role="status">Register locks in {Math.ceil(remainingMs / 1000)} seconds. <button className="secondary-action" onClick={noteActivity}>Stay signed in</button></div>}
    {error && <ErrorState message={error} onRetry={() => void load()} />}
    {recoveryBlocked && <p className="error-message"><a href="/login?next=%2Fpos&amp;expired=1">Sign in again to recover the previous payment</a></p>}
    {policy && <PaymentStatus policy={policy} />}
    {loading && <LoadingState label="Loading register…" />}
    <div className="pos-layout" data-read-only={!canCheckout||undefined} aria-busy={busy} inert={busy || loading || recoveryBlocked || !!error || undefined}>
      {canCheckout&&<a className="pos-cart-link" href="#pos-cart"><Icon name="bag" size={18} />View cart · {itemCount} {itemCount === 1 ? 'item' : 'items'}</a>}
      <ProductGrid canSelect={canCheckout} products={products} onSelect={product => mutateCart(current => addProduct(current, product))} />
      {canCheckout&&<CartPanel canRedeem={canRedeem} cart={cart} products={products} subtotal={subtotal} discount={discount} total={total} coupon={coupon} cartLines={cartLines}
        onCouponApply={code => void applyCoupon(code)} couponChecking={calculation.status === 'pending'} couponError={calculation.status === 'error' ? calculation.message : null} couponBlocked={couponBlocked}
        onCouponRemoved={() => { checkoutKey.current = null; dispatch({ type: 'coupon-clear' }) }}
        onChange={(id, delta, max) => mutateCart(current => changeQuantity(current, id, delta, max))} onCheckout={() => void checkout()}
        tenderMode={tenderMode} cashEnabled={policy?.cash_enabled ?? false} busy={busy || loading || recoveryBlocked}
        onTenderChange={mode => { setTenderMode(mode); checkoutKey.current = null }} />}
    </div>
    {intent && <PaymentDialog intent={intent} onClose={() => { setIntent(null); checkoutKey.current = null }} onComplete={completed} />}
    {receipt && <ReceiptDialog canReadRefunds={canReadRefunds} receipt={receipt} items={receiptItems} onClose={() => setReceipt(null)} />}
  </main>
}
