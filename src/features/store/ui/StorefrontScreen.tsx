'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { addProduct, cartTotal, changeQuantity, toCartLines, type CartState } from '@/features/pos/cart'
import type { CatalogProduct } from '@/features/pos/domain'
import {
  fetchCustomerSession, fetchDeliveryLocations, fetchStoreCatalog, loginCustomer,
  logoutCustomer, placeOnlineOrder,
} from '@/features/store/client'
import type { CustomerSession, DeliveryLocation, OnlineOrderReceipt } from '@/features/store/domain'
import { formatWon } from '@/lib/format/currency'
import { ClientApiError } from '@/lib/api/client'

export function StorefrontScreen() {
  const [products, setProducts] = useState<CatalogProduct[]>([])
  const [locations, setLocations] = useState<DeliveryLocation[]>([])
  const [cart, setCart] = useState<CartState>({})
  const [session, setSession] = useState<CustomerSession | null>(null)
  const [cardNumber, setCardNumber] = useState('')
  const [pin, setPin] = useState('')
  const [locationId, setLocationId] = useState('')
  const [couponCode, setCouponCode] = useState('')
  const [deliveryNote, setDeliveryNote] = useState('')
  const [receipt, setReceipt] = useState<OnlineOrderReceipt | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const lines = useMemo(() => toCartLines(cart), [cart])
  const subtotal = useMemo(() => cartTotal(cart, products), [cart, products])
  const orderableLocations = locations.filter((location) => location.orderable)

  async function loadCatalog() {
    setProducts(await fetchStoreCatalog())
  }

  useEffect(() => {
    let active = true
    Promise.all([fetchStoreCatalog(), fetchDeliveryLocations()]).then(([catalog, delivery]) => {
      if (!active) return
      setProducts(catalog)
      setLocations(delivery)
      const first = delivery.find((location) => location.orderable)
      if (first) setLocationId(first.location_id)
    }).catch((caught: unknown) => active && setError(caught instanceof Error ? caught.message : 'Store could not be loaded'))
    fetchCustomerSession().then((value) => active && setSession(value)).catch(() => undefined)
    return () => { active = false }
  }, [])

  async function signIn() {
    setBusy(true); setError(null)
    try {
      const next = await loginCustomer(cardNumber, pin)
      setSession(next); setPin('')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Sign-in failed')
    } finally { setBusy(false) }
  }

  async function signOut() {
    setBusy(true)
    try { await logoutCustomer(); setSession(null); setReceipt(null) }
    finally { setBusy(false) }
  }

  async function submitOrder() {
    if (!session) { setError('Sign in with the card number printed on your CampusPay card and your PIN.'); return }
    if (!locationId || lines.length === 0) return
    setBusy(true); setError(null)
    try {
      const next = await placeOnlineOrder({
        items: lines,
        couponCode: couponCode.trim() || null,
        deliveryLocationId: locationId,
        deliveryNote: deliveryNote.trim() || null,
      })
      setReceipt(next); setCart({}); setCouponCode(''); setDeliveryNote('')
      await loadCatalog()
      try { setSession(await fetchCustomerSession()) } catch { setSession(null) }
    } catch (caught) {
      const message = caught instanceof ClientApiError && caught.code === 'WALLET_LIMIT'
        ? 'This order would take your CampusPay wallet below −₩15,000.'
        : caught instanceof Error ? caught.message : 'Order could not be placed'
      setError(message)
    } finally { setBusy(false) }
  }

  return <main className="store-page">
    <header className="store-header">
      <Link href="/store" className="store-brand"><span>CP</span><div><strong>CampusPay</strong><small>Student Store</small></div></Link>
      <div className="store-header-actions">
        <Link href="/store/orders" className="secondary-action">My orders</Link>
        {session && <button className="secondary-action" onClick={() => void signOut()} disabled={busy}>Sign out</button>}
      </div>
    </header>

    <section className="store-hero">
      <div><p className="eyebrow">Delivered inside school</p><h1>Order from the Student Store.</h1><p>Use the card number printed on your CampusPay card and your PIN at checkout. Orders use the same wallet and stock as the physical store.</p></div>
      {session && <div className="store-wallet"><small>{session.display_name}</small><strong>{formatWon(session.balance_won)}</strong><span>{session.debt_won ? `${formatWon(session.debt_won)} outstanding` : 'Available wallet balance'}</span></div>}
    </section>

    {error && <p className="error-message store-error">{error}</p>}
    {receipt && <section className="store-receipt">
      <div><p className="eyebrow">Order placed</p><h2>{receipt.order_number}</h2></div>
      <div><strong>{formatWon(receipt.total_won)}</strong><span>{receipt.delivery_building} · Floor {receipt.delivery_floor} · Room {receipt.delivery_room}</span></div>
    </section>}

    <div className="store-layout">
      <section>
        <div className="store-section-heading"><div><p className="eyebrow">In stock now</p><h2>Shop</h2></div><span>{products.filter((product) => !product.sold_out).length} available</span></div>
        <div className="store-product-grid">
          {products.map((product) => <button key={product.id} className="store-product-card" disabled={product.sold_out}
            onClick={() => setCart((current) => addProduct(current, product))}>
            <span className="product-category">{product.category}</span>
            <strong>{product.name}</strong>
            <span>{formatWon(product.selling_price_won)}</span>
            <small>{product.sold_out ? 'Sold out' : `${product.stock_on_hand} in stock`}</small>
          </button>)}
        </div>
      </section>

      <aside className="store-cart">
        <div><p className="eyebrow">Your order</p><h2>Cart</h2></div>
        <div className="store-cart-lines">
          {lines.length === 0 && <p className="muted">Add an item to start an order.</p>}
          {lines.map((line) => {
            const product = products.find((candidate) => candidate.id === line.productId)
            if (!product) return null
            return <div className="cart-line" key={line.productId}>
              <div><strong>{product.name}</strong><small>{formatWon(product.selling_price_won * line.quantity)}</small></div>
              <div className="quantity"><button onClick={() => setCart((current) => changeQuantity(current, product.id, -1, product.stock_on_hand))}>−</button><b>{line.quantity}</b><button onClick={() => setCart((current) => changeQuantity(current, product.id, 1, product.stock_on_hand))}>+</button></div>
            </div>
          })}
        </div>
        <div className="cart-total"><span>Subtotal</span><strong>{formatWon(subtotal)}</strong></div>

        {!session && <section className="store-auth-card">
          <h3>Sign in to order</h3>
          <label className="field"><span>Card number</span><input value={cardNumber} onChange={(event) => setCardNumber(event.target.value)} autoComplete="username" placeholder="Number printed on your RFID card" /></label>
          <label className="field"><span>PIN</span><input value={pin} onChange={(event) => setPin(event.target.value)} type="password" inputMode="numeric" autoComplete="current-password" /></label>
          <button className="primary-action" disabled={busy || cardNumber.length < 6 || pin.length < 4} onClick={() => void signIn()}>{busy ? 'Signing in…' : 'Sign in'}</button>
        </section>}

        {session && <section className="store-checkout-fields">
          <label className="field"><span>Deliver to</span><select value={locationId} onChange={(event) => setLocationId(event.target.value)}>
            {orderableLocations.map((location) => <option key={location.location_id} value={location.location_id}>{location.building} · Floor {location.floor} · Room {location.room}</option>)}
          </select></label>
          <div className="delivery-coming-soon">
            {locations.filter((location) => !location.orderable).map((location) => <small key={location.location_id}>{location.building} · Floor {location.floor}: rooms coming soon</small>)}
          </div>
          <label className="field"><span>Coupon code</span><input value={couponCode} onChange={(event) => setCouponCode(event.target.value)} placeholder="Optional" /></label>
          <label className="field"><span>Delivery note</span><input value={deliveryNote} maxLength={240} onChange={(event) => setDeliveryNote(event.target.value)} placeholder="Optional instructions" /></label>
          <button className="primary-action" disabled={busy || lines.length === 0 || !locationId} onClick={() => void submitOrder()}>{busy ? 'Placing order…' : `Place order · ${formatWon(subtotal)}`}</button>
          <small className="muted">Final coupon eligibility, wallet limit, and stock are rechecked when the order is placed.</small>
        </section>}
      </aside>
    </div>
  </main>
}
