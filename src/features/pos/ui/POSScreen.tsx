'use client'

import './pos.css'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CouponQuote } from '@/features/coupons/domain'
import { addProduct, cartTotal, changeQuantity, toCartLines, type CartState } from '@/features/pos/cart'
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

export function POSScreen({ cashierName }: { cashierName: string }) {
  const [products, setProducts] = useState<CatalogProduct[]>([])
  const [cart, setCart] = useState<CartState>({})
  const [coupon, setCoupon] = useState<{ code: string; quote: CouponQuote } | null>(null)
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
  const subtotal = useMemo(() => cartTotal(cart, products), [cart, products])
  const discount = coupon?.quote.discount_won ?? 0
  const total = coupon?.quote.total_won ?? subtotal

  const recoverPending = useCallback(async () => {
    const id = readPendingPayment()
    if (!id) return
    try {
      const result = await recoverPaymentIntent(id)
      forgetPendingPayment(); setRecoveryBlocked(false)
      if (result.receipt) { setReceipt(result.receipt); setReceiptItems(result.items) }
    } catch {
      setRecoveryBlocked(true)
      throw new Error('A previous payment still needs a confirmed result. Sign in again on this register or retry recovery before starting another sale.')
    }
  }, [])

  async function load() {
    setLoading(true)
    try { const [catalog, paymentPolicy] = await Promise.all([fetchCatalog(), fetchPaymentPolicy()]); setProducts(catalog); setPolicy(paymentPolicy); await recoverPending(); setError(null) }
    catch (caught) { setError(caught instanceof Error ? caught.message : 'Catalog could not be loaded') }
    finally { setLoading(false) }
  }
  useEffect(() => {
    let active = true
    void Promise.all([fetchCatalog(), fetchPaymentPolicy()]).then(async ([catalog, paymentPolicy]) => {
      if (active) { setProducts(catalog); setPolicy(paymentPolicy); await recoverPending(); setError(null) }
    }).catch((caught: unknown) => {
      if (active) setError(caught instanceof Error ? caught.message : 'Catalog could not be loaded')
    }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [recoverPending])

  function mutateCart(update: (current: CartState) => CartState) {
    checkoutKey.current = null; setCoupon(null); setCart(update)
  }
  async function checkout() {
    if (pending.current || !cartLines.length) return
    pending.current = true; setBusy(true)
    checkoutKey.current ??= crypto.randomUUID()
    try {
      const nextIntent = await openPaymentIntent(cartLines, coupon?.code ?? null, tenderMode, null, checkoutKey.current)
      setIntent({ ...nextIntent, pricesChanged: nextIntent.subtotal_won !== subtotal })
      setReceiptItems(nextIntent.items ?? [])
      setError(null)
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Checkout could not be opened') }
    finally { pending.current = false; setBusy(false) }
  }
  function completed(nextReceipt: PaymentReceipt, recoveredItems?: ReceiptLine[]) {
    setReceiptItems(recoveredItems ?? [])
    setReceipt(nextReceipt); setIntent(null); setCart({}); setCoupon(null); setTenderMode('WALLET'); checkoutKey.current = null; void load()
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
      <div className="session-chip"><span>{cashierName}</span><span>{policy?.terminal_label ?? 'Register'}</span>{policy?.cash_enabled && <b>Cash enabled · {policy.event_name}</b>}</div>
    </header>
    {warning && <div className="timeout-warning" role="status">Register locks in {Math.ceil(remainingMs / 1000)} seconds. <button className="secondary-action" onClick={noteActivity}>Stay signed in</button></div>}
    {error && <ErrorState message={error} onRetry={() => void load()} />}
    {recoveryBlocked && <p className="error-message"><a href="/login?next=%2Fpos&amp;expired=1">Sign in again to recover the previous payment</a></p>}
    {policy && <PaymentStatus policy={policy} />}
    {loading && <LoadingState label="Loading register…" />}
    <div className="pos-layout" aria-busy={busy} inert={busy || loading || recoveryBlocked || !!error || undefined}>
      <ProductGrid products={products} onSelect={product => mutateCart(current => addProduct(current, product))} />
      <CartPanel cart={cart} products={products} subtotal={subtotal} discount={discount} total={total} coupon={coupon} cartLines={cartLines}
        onCouponApplied={(code, quote) => { checkoutKey.current = null; setCoupon({ code, quote }) }} onCouponRemoved={() => { checkoutKey.current = null; setCoupon(null) }}
        onChange={(id, delta, max) => mutateCart(current => changeQuantity(current, id, delta, max))} onCheckout={() => void checkout()}
        tenderMode={tenderMode} cashEnabled={policy?.cash_enabled ?? false} busy={busy || loading || recoveryBlocked}
        onTenderChange={mode => { setTenderMode(mode); checkoutKey.current = null }} />
    </div>
    {intent && <PaymentDialog intent={intent} onClose={() => { setIntent(null); checkoutKey.current = null }} onComplete={completed} />}
    {receipt && <ReceiptDialog receipt={receipt} items={receiptItems} onClose={() => setReceipt(null)} />}
  </main>
}
