import type { CustomerOrder } from '@/features/store/domain'
import { orderStatusLabel, orderTime } from '@/features/store/presentation'
import { formatWon } from '@/lib/format/currency'
import { OrderTimeline } from './OrderTimeline'
import styles from './store.module.css'

export function CustomerOrderCard({ order, recipient }: { order: CustomerOrder; recipient: string }) {
  return <article className={styles.orderCard}>
    <div className={styles.orderTop}><div><h2>{order.order_number}</h2><time dateTime={order.created_at}>{orderTime(order.created_at)} · KST</time></div><span className={styles.status} data-delivered={order.status === 'DELIVERED'}>{orderStatusLabel(order.status)}</span><strong className={styles.orderAmount}>{formatWon(order.total_won)}</strong></div>
    <p className={styles.destination}>{order.delivery_building} · Floor {order.delivery_floor} · Room {order.delivery_room}</p>
    <details className={styles.orderDetails} open={order.status !== 'DELIVERED'}><summary>Order details &amp; delivery progress</summary><div className={styles.orderDetailGrid}>
      <div><div className={styles.orderItems}>{order.items.map((item) => <div key={item.product_id}><span><strong>{item.quantity} ×</strong> {item.name}<small>{formatWon(item.unit_price_won)} each</small></span><strong>{formatWon(item.line_total_won)}</strong></div>)}</div><dl className={styles.totals}><div><dt>Subtotal</dt><dd>{formatWon(order.subtotal_won)}</dd></div><div><dt>Discount</dt><dd>{order.discount_won ? `−${formatWon(order.discount_won)}` : formatWon(0)}</dd></div><div className={styles.finalTotal}><dt>MICA Money paid</dt><dd>{formatWon(order.total_won)}</dd></div></dl><p className={styles.recipient}>Recipient: <strong>{recipient}</strong></p>{order.delivery_note && <p className={styles.notice}>Delivery note: {order.delivery_note}</p>}<p className={styles.muted}>Wallet after purchase: {formatWon(order.balance_after_won)}</p></div>
      <OrderTimeline status={order.status} events={order.timeline} />
    </div></details>
  </article>
}
