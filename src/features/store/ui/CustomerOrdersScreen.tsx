'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { fetchCustomerOrders, fetchCustomerSession } from '@/features/store/client'
import type { CustomerOrder, CustomerSession } from '@/features/store/domain'
import { formatWon } from '@/lib/format/currency'

function statusLabel(status: string) {
  return status.replaceAll('_', ' ').toLowerCase().replace(/^./, (letter) => letter.toUpperCase())
}

export function CustomerOrdersScreen() {
  const [session, setSession] = useState<CustomerSession | null>(null)
  const [orders, setOrders] = useState<CustomerOrder[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    Promise.all([fetchCustomerSession(), fetchCustomerOrders()]).then(([customer, orderRows]) => {
      if (!active) return
      setSession(customer); setOrders(orderRows)
    }).catch((caught: unknown) => active && setError(caught instanceof Error ? caught.message : 'Sign in from the store to see orders.'))
    return () => { active = false }
  }, [])

  return <main className="store-page">
    <header className="store-header">
      <Link href="/store" className="store-brand"><span>CP</span><div><strong>CampusPay</strong><small>Student Store</small></div></Link>
      <Link href="/store" className="secondary-action">Back to store</Link>
    </header>
    <section className="store-hero compact">
      <div><p className="eyebrow">Order history</p><h1>My orders</h1><p>{session ? `${session.display_name} · Wallet ${formatWon(session.balance_won)}` : 'Sign in from the store to see your orders.'}</p></div>
    </section>
    {error && <p className="error-message store-error">{error}</p>}
    <section className="store-order-list">
      {orders.length === 0 && !error && <div className="panel"><p className="muted">No online orders yet.</p></div>}
      {orders.map((order) => <article className="store-order-card" key={order.order_id}>
        <div className="store-order-top"><div><p className="eyebrow">{order.order_number}</p><h2>{statusLabel(order.status)}</h2></div><strong>{formatWon(order.total_won)}</strong></div>
        <p className="muted">{order.delivery_building} · Floor {order.delivery_floor} · Room {order.delivery_room}</p>
        <div className="store-order-items">{order.items.map((item) => <div key={item.product_id}><span>{item.quantity} × {item.name}</span><strong>{formatWon(item.line_total_won)}</strong></div>)}</div>
        {order.discount_won > 0 && <p className="muted">Coupon savings: {formatWon(order.discount_won)}</p>}
        {order.delivery_note && <p className="delivery-note">Note: {order.delivery_note}</p>}
        <small className="muted">Placed {new Date(order.created_at).toLocaleString()}</small>
      </article>)}
    </section>
  </main>
}
