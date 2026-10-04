'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import { addProduct, changeQuantity, toCartLines, type CartState } from '@/features/pos/cart'
import type { CatalogProduct } from '@/features/pos/domain'
import { fetchCustomerSession, fetchDeliveryLocations, fetchStoreCatalog, placeOnlineOrder, quoteCustomerOrder, recoverCustomerOrder } from '@/features/store/client'
import type { CustomerProfile, DeliveryLocation, OnlineOrderReceipt } from '@/features/store/domain'
import { customerLoginPath } from '@/features/store/navigation'
import { customerProfile, isCustomerSessionError, storeErrorMessage } from '@/features/store/presentation'
import { formatWon } from '@/lib/format/currency'
import { ClientApiError } from '@/lib/api/client'
import { clearPendingOrder, readPendingOrder, savePendingOrder } from '@/features/store/order-recovery'
import { Icon } from '@/components/ui/Icon'
import { ProductCategoryIcon, categoryTone } from '@/components/ui/ProductCategoryIcon'
import { StoreShell } from './StoreShell'
import { StoreCart, type OrderProposal, type ReviewedOrder } from './StoreCart'
import styles from './store.module.css'

export function StorefrontScreen({ initialSession }: { initialSession: CustomerProfile }) {
  const router = useRouter()
  const processing = useRef(false)
  const [products, setProducts] = useState<CatalogProduct[]>([])
  const [locations, setLocations] = useState<DeliveryLocation[]>([])
  const [cart, setCart] = useState<CartState>({})
  const [session, setSession] = useState(initialSession)
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState('All')
  const [receipt, setReceipt] = useState<OnlineOrderReceipt | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [announcement, setAnnouncement] = useState('')
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)
  const [refreshCount, setRefreshCount] = useState(0)
  const [review, setReview] = useState<ReviewedOrder | null>(null)
  const [uncertain, setUncertain] = useState(false)
  const [pendingId, setPendingId] = useState<string | null>(null)
  const lines = toCartLines(cart)
  const itemCount = lines.reduce((total, line) => total + line.quantity, 0)
  const categories = ['All', ...new Set(products.map((product) => product.category))]
  const visible = products.filter((product) => (category === 'All' || product.category === category) && `${product.name} ${product.category}`.toLowerCase().includes(search.trim().toLowerCase()))

  useEffect(() => {
    let active = true
    void Promise.resolve().then(() => {
      if (!active) return
      const pending = readPendingOrder(initialSession.student_id)
      if (pending) {
        setPendingId(pending.idempotencyKey)
        setUncertain(true); setAnnouncement('An earlier order needs confirmation. Recover its result before placing another order.')
      }
    })
    Promise.all([fetchStoreCatalog(), fetchDeliveryLocations()]).then(([catalog, delivery]) => {
      if (!active) return
      setProducts(catalog); setLocations(delivery); setError(null); setLoading(false)
    }).catch((caught: unknown) => {
      if (!active) return
      if (isCustomerSessionError(caught)) { router.replace(customerLoginPath('/store', true)); router.refresh() }
      else { setError(storeErrorMessage(caught)); setLoading(false) }
    })
    return () => { active = false }
  }, [router, refreshCount, initialSession.student_id])

  function handleError(caught: unknown) {
    if (isCustomerSessionError(caught)) { router.replace(customerLoginPath('/store', true)); router.refresh(); return }
    setError(storeErrorMessage(caught))
  }

  async function recoverOrder() {
    if (!pendingId || processing.current) return
    processing.current = true; setBusy(true); setError(null)
    try {
      const next = await recoverCustomerOrder(pendingId)
      clearPendingOrder(session.student_id)
      setPendingId(null); setUncertain(false); setReview(null); setCart({})
      if (next) {
        setReceipt(next)
        setSession(current => ({ ...current, balance_won: next.balance_after_won, debt_won: next.debt_after_won }))
      } else setAnnouncement('The earlier order was not placed. That request is now closed; you can start a new order.')
    } catch (caught) { handleError(caught) }
    finally { processing.current = false; setBusy(false) }
  }

  async function reviewOrder(input: OrderProposal) {
    if (processing.current) return
    processing.current = true; setBusy(true); setError(null)
    try {
      const quote = await quoteCustomerOrder(input.items, input.couponCode)
      setReview({ input, quote, idempotencyKey: crypto.randomUUID() }); setUncertain(false)
      setAnnouncement('Your order is ready to review. Check the total before placing it.')
    } catch (caught) { handleError(caught) }
    finally { processing.current = false; setBusy(false) }
  }

  async function submitOrder() {
    if (!review || processing.current) return
    processing.current = true; setBusy(true); setError(null)
    try { savePendingOrder(session.student_id, review) }
    catch {
      setError('Your browser couldn’t prepare a safe checkout. Please try again or use another browser.')
      processing.current = false; setBusy(false); return
    }
    try {
      const next = await placeOnlineOrder({ ...review.input, idempotencyKey: review.idempotencyKey, expectedTotalWon: review.quote.total_won })
      clearPendingOrder(session.student_id)
      setReceipt(next); setCart({}); setReview(null); setUncertain(false); setPendingId(null)
      setSession((current) => ({ ...current, balance_won: next.balance_after_won, debt_won: next.debt_after_won }))
      setAnnouncement(`Order ${next.order_number} placed. Your wallet was charged ${formatWon(next.total_won)}.`)
      // A refresh failure must not turn an authoritative paid receipt into a failure.
      void Promise.all([fetchStoreCatalog(), fetchCustomerSession()]).then(([catalog, customer]) => {
        setProducts(catalog); setSession(customerProfile(customer))
      }).catch(() => undefined)
    } catch (caught) {
      if (!(caught instanceof ClientApiError) || caught.status >= 500) {
        setPendingId(review.idempotencyKey)
        setUncertain(true); setError('Your order result is not yet confirmed. Recover the result below before placing another order.')
      } else if (uncertain) {
        // A later failure cannot prove the earlier request failed. Keep its UUID across reauthentication.
        if (isCustomerSessionError(caught)) handleError(caught)
        else setError('The earlier order still needs confirmation. Check My orders or retry this same order when the connection is restored.')
      } else { clearPendingOrder(session.student_id); setReview(null); if (isCustomerSessionError(caught)) handleError(caught); else setError(`${storeErrorMessage(caught)} Nothing was charged.`) }
    } finally { processing.current = false; setBusy(false) }
  }

  return <StoreShell session={session}>
    <div className={styles.welcome}>
      <div className={styles.welcomeCopy}><p className={styles.eyebrow}><Icon name="sparkles" size={15} />Welcome, {session.display_name}</p><h1>Your school day, delivered.</h1><p className={styles.muted}>Pick your favourites. We’ll bring them to your room.</p></div>
      <div className={styles.welcomeArt} aria-hidden="true"><span><Icon name="cup" size={46} /></span><span><Icon name="snack" size={32} /></span></div>
      <a className={styles.cartLink} href="#cart"><Icon name="bag" size={19} />Your cart <strong>{itemCount}</strong></a>
    </div>
    <span className={styles.srOnly} role="status" aria-live="polite">{announcement}</span>
    {error && <div className={uncertain ? "uncertain-result" : styles.error} role="alert">{error}{!busy && !uncertain && <button className={styles.textButton} onClick={() => { setLoading(true); setRefreshCount((count) => count + 1) }}>Refresh store</button>}</div>}
    {pendingId && <section className="uncertain-result" role="alert"><strong>Order result unknown.</strong><p>Recover the earlier result before placing another order. If it was not placed, recovery safely closes that request.</p><button className={styles.primary} disabled={busy} onClick={() => void recoverOrder()}>{busy ? 'Checking order…' : 'Recover order'}</button><Link href="/store/orders">Check My orders</Link></section>}
    {receipt && <section className={styles.receipt} role="status"><div><p className={styles.eyebrow}><Icon name="check" size={16} />Order confirmed</p><h2>{receipt.order_number}</h2><p>{receipt.delivery_building} · Floor {receipt.delivery_floor} · Room {receipt.delivery_room}</p></div><div><strong>{formatWon(receipt.total_won)}</strong><span>MICA Money payment complete</span><Link href="/store/orders">Track your order →</Link></div></section>}
    <div className={styles.shopLayout}>
      <section aria-labelledby="shop-title">
        <div className={styles.sectionTitle}><h2 id="shop-title">Shop the student store</h2><span className={styles.availableCount}>{products.filter((product) => !product.sold_out).length} available</span></div>
        <label className={`${styles.search} ${styles.catalogSearch}`} htmlFor="store-search"><Icon name="search" size={20} /><span className={styles.srOnly}>Search products</span><input id="store-search" type="search" placeholder="Search snacks, drinks and more" value={search} onChange={(event) => setSearch(event.target.value)} /></label>
        <div className={styles.categories} role="group" aria-label="Product categories">{categories.map((name) => <button key={name} aria-pressed={category === name} onClick={() => setCategory(name)}>{name === 'All' ? <Icon name="grid" size={18} /> : <ProductCategoryIcon category={name} size={18} />}{name}</button>)}</div>
        {loading ? <div className={styles.empty} role="status"><span className={styles.emptyIcon}><Icon name="bag" size={30} /></span>Loading your store…</div> : visible.length === 0 ? <div className={styles.empty}><span className={styles.emptyIcon}><Icon name={products.length === 0 ? 'bag' : 'search'} size={30} /></span><h3>{products.length === 0 ? 'The store is getting ready' : 'No matching items'}</h3><p>{products.length === 0 ? 'Check back soon for available products.' : 'Try another search or category.'}</p>{products.length > 0 && <button className={styles.secondary} onClick={() => { setSearch(''); setCategory('All') }}>Show all products</button>}</div> : <div className={styles.products}>{visible.map((product) => <article className={styles.product} key={product.id} data-category-tone={categoryTone(product.category)} data-sold-out={product.sold_out}>
          <div className={styles.productVisual} aria-hidden="true"><span className={styles.productMedallion}><ProductCategoryIcon category={product.category} size={38} /></span></div>
          <div className={styles.productInfo}><span className={styles.productCategory}>{product.category}</span><h3>{product.name}</h3><span className={styles.availability} data-stock={product.sold_out ? 'sold-out' : product.stock_on_hand <= 5 ? 'low' : 'available'}>{product.sold_out ? 'Sold out' : product.stock_on_hand <= 5 ? `Only ${product.stock_on_hand} left` : 'Available today'}</span><div className={styles.productBottom}><strong>{formatWon(product.selling_price_won)}</strong><button className={styles.addButton} disabled={product.sold_out || busy || pendingId !== null || review !== null || (cart[product.id] ?? 0) >= Math.min(product.stock_on_hand, 99)} aria-label={`Add ${product.name} to cart`} onClick={() => {
            setCart((current) => addProduct(current, { ...product, stock_on_hand: Math.min(product.stock_on_hand, 99) })); setAnnouncement(`${product.name} added to your cart.`)
          }}>Add <Icon name="plus" size={17} /></button></div></div>
        </article>)}</div>}
      </section>
      {!loading && !pendingId && <StoreCart key={receipt?.order_id ?? 'new-cart'} lines={lines} products={products} locations={locations} session={session} busy={busy} review={review} uncertain={uncertain} onQuantity={(product, delta) => setCart((current) => changeQuantity(current, product.id, delta, Math.min(product.stock_on_hand, 99)))} onReview={reviewOrder} onPlace={submitOrder} onAdjust={() => { clearPendingOrder(session.student_id); setReview(null); setError(null) }} />}
    </div>
  </StoreShell>
}
