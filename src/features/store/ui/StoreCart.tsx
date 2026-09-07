'use client'

import Link from 'next/link'
import { useState, type FormEvent } from 'react'
import type { CartLine, CatalogProduct } from '@/features/pos/domain'
import type { CustomerProfile, DeliveryLocation, OnlineOrderQuote } from '@/features/store/domain'
import { formatWon } from '@/lib/format/currency'
import { DeliverySelector } from './DeliverySelector'
import styles from './store.module.css'

export type OrderProposal = {
  items: CartLine[]; couponCode: string | null; deliveryLocationId: string; deliveryNote: string | null
}
export type ReviewedOrder = { input: OrderProposal; quote: OnlineOrderQuote; idempotencyKey: string }

export function StoreCart({ lines, products, locations, session, busy, review, uncertain, onQuantity, onReview, onPlace, onAdjust }: {
  lines: CartLine[]; products: CatalogProduct[]; locations: DeliveryLocation[]; session: CustomerProfile
  busy: boolean; review: ReviewedOrder | null; uncertain: boolean
  onQuantity: (product: CatalogProduct, delta: number) => void
  onReview: (input: OrderProposal) => Promise<void>; onPlace: () => Promise<void>; onAdjust: () => void
}) {
  const [locationId, setLocationId] = useState('')
  const [coupon, setCoupon] = useState('')
  const [note, setNote] = useState('')
  const byId = new Map(products.map((product) => [product.id, product]))
  const subtotal = lines.reduce((total, line) => total + (byId.get(line.productId)?.selling_price_won ?? 0) * line.quantity, 0)
  const quote = review?.quote
  const locked = busy || review !== null
  const selected = locations.find((location) => location.location_id === (review?.input.deliveryLocationId ?? locationId))
  async function submit(event: FormEvent) {
    event.preventDefault()
    if (review) await onPlace()
    else await onReview({ items: lines, couponCode: coupon.trim() || null, deliveryLocationId: locationId, deliveryNote: note.trim() || null })
  }
  return <aside id="cart" className={styles.cart} aria-labelledby="cart-title">
    <div className={styles.sectionTitle}><h2 id="cart-title">{review ? 'Review your order' : 'Your cart'}</h2><span>{lines.reduce((total, line) => total + line.quantity, 0)} items</span></div>
    {lines.length === 0 ? <div className={styles.empty}><strong>A little something for your day</strong><p>Choose an item from the store to start your order.</p></div> : <>
      <div className={styles.cartLines}>{lines.map((line) => {
        const product = byId.get(line.productId)
        if (!product) return null
        return <div className={styles.cartLine} key={line.productId}><div><strong>{product.name}</strong><small>{formatWon(product.selling_price_won)} each</small></div><div className={styles.cartLineEnd}><strong>{formatWon(product.selling_price_won * line.quantity)}</strong><div className={styles.quantity}><button disabled={locked} aria-label={`Remove one ${product.name}`} onClick={() => onQuantity(product, -1)}>−</button><span aria-label={`${line.quantity} ${product.name}`}>{line.quantity}</span><button disabled={locked || line.quantity >= Math.min(product.stock_on_hand, 99)} aria-label={`Add one ${product.name}`} onClick={() => onQuantity(product, 1)}>+</button></div></div></div>
      })}</div>
      <form className={styles.checkoutForm} onSubmit={(event) => void submit(event)} aria-busy={busy}>
        {review ? <div className={styles.deliveryReview}><strong>{selected?.building} · Floor {selected?.floor} · Room {selected?.room}</strong><span>Recipient: {session.display_name}</span>{review.input.deliveryNote && <p>{review.input.deliveryNote}</p>}</div> : <>
          <DeliverySelector locations={locations} value={locationId} onChange={setLocationId} disabled={busy} />
          <p className={styles.recipient}>Recipient: <strong>{session.display_name}</strong></p>
          <label className={styles.field} htmlFor="delivery-note">Delivery note <span className={styles.optional}>(optional)</span><textarea id="delivery-note" rows={2} maxLength={240} value={note} disabled={busy} onChange={(event) => setNote(event.target.value)} placeholder="Anything we should know?" /></label>
          <label className={styles.field} htmlFor="store-coupon">Coupon code <span className={styles.optional}>(optional)</span><input id="store-coupon" maxLength={40} value={coupon} disabled={busy} autoCapitalize="characters" onChange={(event) => setCoupon(event.target.value)} placeholder="Enter a code" /></label>
        </>}
        <dl className={styles.totals}><div><dt>Subtotal</dt><dd>{formatWon(quote?.subtotal_won ?? subtotal)}</dd></div><div><dt>Discount{quote?.coupon_name ? ` · ${quote.coupon_name}` : ''}</dt><dd>{quote ? (quote.discount_won ? `−${formatWon(quote.discount_won)}` : formatWon(0)) : coupon.trim() ? 'Check at review' : formatWon(0)}</dd></div><div className={styles.finalTotal}><dt>{quote ? 'Order total' : 'Estimated total'}</dt><dd>{formatWon(quote?.total_won ?? subtotal)}</dd></div></dl>
        <div className={styles.walletSummary}><strong>MICA Money wallet</strong><dl className={styles.totals}><div><dt>Wallet balance</dt><dd>{formatWon(quote?.balance_before_won ?? session.balance_won)}</dd></div><div><dt>{quote ? 'After purchase' : 'Estimated after purchase'}</dt><dd>{formatWon(quote?.balance_after_won ?? (session.balance_won - subtotal))}</dd></div></dl></div>
        {uncertain && <p className={styles.notice} role="status">We couldn’t confirm the result. Retry this order safely, or <Link href="/store/orders">check My orders</Link> before starting another.</p>}
        <button className={styles.primary} type="submit" disabled={busy || !(review?.input.deliveryLocationId ?? locationId)}>{busy ? (review ? 'Placing your order…' : 'Checking your order…') : review ? `${uncertain ? 'Retry order' : 'Place order'} · ${formatWon(review.quote.total_won)}` : 'Review order'}</button>
        {review && !uncertain && <button type="button" className={styles.secondary} disabled={busy} onClick={onAdjust}>Edit order</button>}
        <small className={styles.muted}>{review ? 'Your wallet is charged only when your order is confirmed.' : 'Review your discount and final total before placing your order. Wallet minimum: −₩15,000.'}</small>
      </form>
    </>}
  </aside>
}
