'use client'

import { useEffect, useRef, useState } from 'react'
import { advanceOnlineOrder, fetchStaffOnlineOrders } from '@/features/store/client'
import type { StaffOnlineOrder } from '@/features/store/domain'
import { NEXT_ORDER_STATUS } from '@/features/store/fulfillment'
import { ORDER_STEPS, orderStatusLabel, orderTime } from '@/features/store/presentation'
import { formatWon } from '@/lib/format/currency'
import { FulfillmentOrderDetail } from './FulfillmentOrderDetail'
import styles from './store.module.css'

export function OrderFulfillmentScreen() {
  const updating = useRef(false)
  const [orders, setOrders] = useState<StaffOnlineOrder[]>([])
  const [error, setError] = useState<string | null>(null)
  const [announcement, setAnnouncement] = useState('')
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)
  const [refresh, setRefresh] = useState(0)
  const [filter, setFilter] = useState('OPEN')
  const [search, setSearch] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  useEffect(() => {
    let active = true
    fetchStaffOnlineOrders().then((data) => {
      if (!active) return
      setOrders(data); setError(null); setLoading(false)
    }).catch(() => { if (active) { setError('Orders could not be loaded. Refresh to try again.'); setLoading(false) } })
    return () => { active = false }
  }, [refresh])
  async function advance(order: StaffOnlineOrder) {
    const next = NEXT_ORDER_STATUS[order.status]
    if (!next || updating.current) return
    updating.current = true; setBusy(true); setError(null)
    try {
      await advanceOnlineOrder(order.order_id, next.status)
      setAnnouncement(`${order.order_number}: ${orderStatusLabel(next.status)}`)
      setOrders(await fetchStaffOnlineOrders())
    } catch {
      setError('We couldn’t confirm the order update. Refresh the queue to check its current status before trying again.')
    } finally { updating.current = false; setBusy(false) }
  }
  const open = orders.filter((order) => order.status !== 'DELIVERED')
  const visible = orders.filter((order) => (filter === 'OPEN' ? order.status !== 'DELIVERED' : order.status === filter) && `${order.order_number} ${order.student_name} ${order.delivery_building} ${order.delivery_room}`.toLowerCase().includes(search.trim().toLowerCase()))
  const selected = visible.find((order) => order.order_id === selectedId) ?? visible[0]
  return <main className="workspace">
    <header className="workspace-header"><div><p className="eyebrow">MICA Money fulfillment</p><h1>Online orders</h1><p className="muted">Pick, prepare, and deliver student orders.</p></div><button className="secondary-action" disabled={busy || loading} onClick={() => { setLoading(true); setRefresh((value) => value + 1) }}>{loading ? 'Refreshing…' : 'Refresh queue'}</button></header>
    <span className={styles.srOnly} role="status">{announcement}</span>
    {error && <p className="error-message" role="alert">{error}</p>}
    <div className={styles.queueToolbar}><label className={styles.search} htmlFor="order-search"><span className={styles.srOnly}>Search orders, students, or rooms</span><input id="order-search" type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search order, student, or room" /></label><span className={styles.status}>{open.length} open orders</span></div>
    <div className={styles.categories} role="group" aria-label="Filter orders by status">{['OPEN', ...ORDER_STEPS].map((status) => <button key={status} aria-pressed={filter === status} onClick={() => { setFilter(status); setSelectedId(null) }}>{status === 'OPEN' ? 'All open' : orderStatusLabel(status)} <span>{status === 'OPEN' ? open.length : orders.filter((order) => order.status === status).length}</span></button>)}</div>
    {loading && <p className={styles.notice} role="status">Loading the fulfillment queue…</p>}
    {!loading && visible.length === 0 && <section className={styles.empty}><h2>{search ? 'No matching orders' : 'All caught up'}</h2><p>{search ? 'Try a different order number, student, or room.' : 'Orders in this stage will appear here. Refresh to check for new orders.'}</p></section>}
    {visible.length > 0 && <div className={styles.queueLayout}><div className={styles.queueTable}><table><thead><tr><th scope="col">Order &amp; student</th><th scope="col">Destination</th><th scope="col">Status / total</th></tr></thead><tbody>{visible.map((order) => <tr key={order.order_id} data-selected={order.order_id === selected?.order_id}><td><button className={styles.orderSelect} aria-pressed={order.order_id === selected?.order_id} onClick={() => setSelectedId(order.order_id)}><strong>{order.order_number}</strong><span>{order.student_name}</span></button><small>{orderTime(order.created_at)} · {order.items.reduce((total, item) => total + item.quantity, 0)} items</small></td><td>{order.delivery_building}<small>Floor {order.delivery_floor} · Room {order.delivery_room}</small></td><td><span className={styles.queueStatus}>{orderStatusLabel(order.status)}</span><strong className={styles.queueAmount}>{formatWon(order.total_won)}</strong></td></tr>)}</tbody></table></div>{selected && <FulfillmentOrderDetail key={selected.order_id} order={selected} busy={busy || loading} onAdvance={() => void advance(selected)} />}</div>}
  </main>
}
