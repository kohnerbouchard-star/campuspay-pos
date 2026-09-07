'use client'
import { useState } from 'react'
import type { StaffOnlineOrder } from '@/features/store/domain'
import { NEXT_ORDER_STATUS } from '@/features/store/fulfillment'
import { orderStatusLabel, orderTime } from '@/features/store/presentation'
import { formatWon } from '@/lib/format/currency'
import { OrderTimeline } from './OrderTimeline'
import styles from './store.module.css'

export function FulfillmentOrderDetail({ order, busy, onAdvance }: { order: StaffOnlineOrder; busy: boolean; onAdvance: () => void }) {
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const next = NEXT_ORDER_STATUS[order.status]
  const picking = order.status === 'PICKING'
  const allPicked = order.items.every((item) => picked.has(item.product_id))
  return <section className={styles.fulfillmentDetail} aria-labelledby="fulfillment-detail-title">
    <div className={styles.sectionTitle}><div><p className={styles.eyebrow}>Order detail</p><h2 id="fulfillment-detail-title">{order.order_number}</h2></div><span className={styles.status}>{orderStatusLabel(order.status)}</span></div>
    <div className={styles.deliveryReview}><strong>{order.delivery_building} · Floor {order.delivery_floor} · Room {order.delivery_room}</strong><span>Recipient: {order.student_name}</span><small>Placed {orderTime(order.created_at)} · KST</small></div>
    <h3>{picking ? 'Pick every item' : 'Items'}</h3>
    <div className={styles.pickingList}>{order.items.map((item) => <label key={item.product_id} className={styles.pickingItem}>
      {picking && <input type="checkbox" disabled={busy} checked={picked.has(item.product_id)} onChange={(event) => setPicked((current) => { const nextSet = new Set(current); if (event.target.checked) nextSet.add(item.product_id); else nextSet.delete(item.product_id); return nextSet })} />}
      <span><strong>{item.quantity} × {item.name}</strong><small>{formatWon(item.unit_price_won)} each</small></span><strong>{formatWon(item.line_total_won)}</strong>
    </label>)}</div>
    {order.delivery_note && <div className={styles.notice}><strong>Delivery note</strong><p>{order.delivery_note}</p></div>}
    <dl className={styles.totals}><div className={styles.finalTotal}><dt>Paid · MICA Money</dt><dd>{formatWon(order.total_won)}</dd></div></dl>
    {picking && !allPicked && <p className={styles.muted}>Check each item when its full quantity has been picked.</p>}
    {next && <button className={styles.primary} disabled={busy || (picking && !allPicked)} onClick={onAdvance}>{busy ? 'Updating order…' : next.label}</button>}
    <h3>Fulfillment timeline</h3><OrderTimeline status={order.status} events={order.timeline} />
  </section>
}
