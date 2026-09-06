'use client'

import { useEffect, useState } from 'react'
import { advanceOnlineOrder, fetchStaffOnlineOrders } from '@/features/store/client'
import type { StaffOnlineOrder } from '@/features/store/domain'
import { formatWon } from '@/lib/format/currency'

const nextStatus: Record<string, { status: 'PICKING'|'READY'|'OUT_FOR_DELIVERY'|'DELIVERED'; label: string } | undefined> = {
  PLACED: { status: 'PICKING', label: 'Start picking' },
  PICKING: { status: 'READY', label: 'Mark ready' },
  READY: { status: 'OUT_FOR_DELIVERY', label: 'Out for delivery' },
  OUT_FOR_DELIVERY: { status: 'DELIVERED', label: 'Mark delivered' },
}

export function OrderFulfillmentScreen() {
  const [orders, setOrders] = useState<StaffOnlineOrder[]>([])
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  async function load() {
    try { setOrders(await fetchStaffOnlineOrders()); setError(null) }
    catch (caught) { setError(caught instanceof Error ? caught.message : 'Orders could not be loaded') }
  }
  useEffect(() => {
  let active = true
  void fetchStaffOnlineOrders()
    .then((data) => {
      if (!active) return
      setOrders(data)
      setError(null)
    })
    .catch((caught) => {
      if (!active) return
      setError(caught instanceof Error ? caught.message : 'Orders could not be loaded')
    })
  return () => { active = false }
}, [])

  async function advance(order: StaffOnlineOrder) {
    const next = nextStatus[order.status]
    if (!next) return
    setBusyId(order.order_id); setError(null)
    try { await advanceOnlineOrder(order.order_id, next.status); await load() }
    catch (caught) { setError(caught instanceof Error ? caught.message : 'Order could not be updated') }
    finally { setBusyId(null) }
  }

  const open = orders.filter((order) => order.status !== 'DELIVERED')
  const delivered = orders.filter((order) => order.status === 'DELIVERED').slice(0, 20)

  return <main className="workspace">
    <header className="workspace-header"><div><p className="eyebrow">Student Store fulfillment</p><h1>Online orders</h1></div><span className="status-pill">{open.length} open</span></header>
    {error && <p className="error-message">{error}</p>}
    <div className="fulfillment-grid">
      {open.length === 0 && <section className="panel"><h2>No open orders</h2><p className="muted">New customer orders will appear here.</p></section>}
      {open.map((order) => {
        const next = nextStatus[order.status]
        return <article className="fulfillment-card" key={order.order_id}>
          <div className="fulfillment-heading"><div><p className="eyebrow">{order.order_number}</p><h2>{order.student_name}</h2></div><span className={`order-status status-${order.status.toLowerCase()}`}>{order.status.replaceAll('_', ' ')}</span></div>
          <div className="delivery-destination"><strong>{order.delivery_building}</strong><span>Floor {order.delivery_floor} · Room {order.delivery_room}</span></div>
          <div className="fulfillment-items">{order.items.map((item) => <div key={item.product_id}><span>{item.quantity} × {item.name}</span><strong>{formatWon(item.line_total_won)}</strong></div>)}</div>
          {order.delivery_note && <p className="delivery-note">{order.delivery_note}</p>}
          <div className="fulfillment-footer"><strong>{formatWon(order.total_won)}</strong>{next && <button className="primary-action" disabled={busyId === order.order_id} onClick={() => void advance(order)}>{busyId === order.order_id ? 'Updating…' : next.label}</button>}</div>
        </article>
      })}
    </div>
    {delivered.length > 0 && <section className="panel delivered-panel"><h2>Recently delivered</h2><div className="table-scroll"><table><thead><tr><th>Order</th><th>Customer</th><th>Destination</th><th>Total</th></tr></thead><tbody>{delivered.map((order) => <tr key={order.order_id}><td>{order.order_number}</td><td>{order.student_name}</td><td>{order.delivery_building} · {order.delivery_room}</td><td>{formatWon(order.total_won)}</td></tr>)}</tbody></table></div></section>}
  </main>
}
