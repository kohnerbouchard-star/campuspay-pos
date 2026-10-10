'use client'

import { useState } from 'react'
import { advanceOnlineOrder } from '@/features/store/client'
import { useFulfillmentQueue } from '@/features/store/use-fulfillment-queue'
import type { StaffOnlineOrder } from '@/features/store/domain'
import { NEXT_ORDER_STATUS } from '@/features/store/fulfillment'
import { ORDER_STEPS, orderStatusLabel, orderTime } from '@/features/store/presentation'
import { formatWon } from '@/lib/format/currency'
import { FulfillmentOrderDetail } from './FulfillmentOrderDetail'
import styles from './store.module.css'

export function OrderFulfillmentScreen({canOperate}:{canOperate:boolean}) {
  const { orders, error, setError, loading, refreshing, needsRefresh, selectedId, setSelectedId, refresh, fetchingRef, updatingRef } = useFulfillmentQueue()
  const [announcement, setAnnouncement] = useState('')
  const [busy, setBusy] = useState(false)
  const [filter, setFilter] = useState('OPEN')
  const [search, setSearch] = useState('')
  const [focusRequest, setFocusRequest] = useState(0)
  async function advance(order: StaffOnlineOrder) {
    const next = NEXT_ORDER_STATUS[order.status]
    if (!canOperate || !next || updatingRef.current || fetchingRef.current || needsRefresh) return
    updatingRef.current = true; setBusy(true); setError(null)
    try {
      await advanceOnlineOrder(order.order_id, next.status)
      setAnnouncement(`${order.order_number}: ${orderStatusLabel(next.status)}`)
    } catch {
      setError('We couldn’t confirm the order update. Refresh the queue to check its current status before trying again.')
    } finally { await refresh(true); updatingRef.current = false; setBusy(false) }
  }
  const isOpenOrder = (status: string) => ['PLACED', 'PICKING', 'READY', 'OUT_FOR_DELIVERY'].includes(status)
  const open = orders.filter((order) => isOpenOrder(order.status))
  const visible = orders.filter((order) => (filter === 'OPEN' ? isOpenOrder(order.status) : filter === 'CLOSED' ? ['DELIVERED', 'CANCELLED', 'RETURNED'].includes(order.status) : order.status === filter) && `${order.order_number} ${order.student_name} ${order.delivery_building} ${order.delivery_room}`.toLowerCase().includes(search.trim().toLowerCase()))
  const selected = visible.find((order) => order.order_id === selectedId) ?? visible[0]
  return <main className="workspace">
    <header className="workspace-header"><div><p className="eyebrow">MICA Money fulfillment</p><h1>Online orders</h1><p className="muted">Oldest orders first · Checks for new orders every 20 seconds.</p></div><button className="secondary-action" disabled={busy || refreshing} onClick={() => void refresh()}>{refreshing ? 'Refreshing…' : 'Refresh queue'}</button></header>
    <span className={styles.srOnly} role="status">{announcement}</span>
    {error && <p className="error-message" role="alert">{error}</p>}
    <div className={styles.queueToolbar}><label className={styles.search} htmlFor="order-search"><span className={styles.srOnly}>Search orders, students, or rooms</span><input id="order-search" type="search" value={search} onChange={(event) => { setSearch(event.target.value); setFocusRequest(0) }} placeholder="Search order, student, or room" /></label><span className={styles.status}>{loading || needsRefresh ? '—' : open.length} open orders</span></div>
    <div className={styles.categories} role="group" aria-label="Filter orders by status">{['OPEN', ...ORDER_STEPS, 'CLOSED', 'RETURNED', 'CANCELLED'].map((status) => <button key={status} aria-pressed={filter === status} onClick={() => { setFilter(status); setSelectedId(null); setFocusRequest(0) }}>{status === 'OPEN' ? 'All open' : status === 'CLOSED' ? 'Closed history' : orderStatusLabel(status)} <span>{status === 'OPEN' ? open.length : status === 'CLOSED' ? orders.filter((order) => ['DELIVERED', 'CANCELLED', 'RETURNED'].includes(order.status)).length : orders.filter((order) => order.status === status).length}</span></button>)}</div>
    {loading && <p className={styles.notice} role="status">Loading the fulfillment queue…</p>}
    {!loading && !error && visible.length === 0 && <section className={styles.empty}><h2>{search ? 'No matching orders' : 'All caught up'}</h2><p>{search ? 'Try a different order number, student, or room.' : 'Orders in this stage will appear here. Refresh to check for new orders.'}</p></section>}
    {visible.length > 0 && <div className={styles.queueLayout}><div className={styles.queueTable}><table><thead><tr><th scope="col">Order &amp; student</th><th scope="col">Destination</th><th scope="col">Status / total</th></tr></thead><tbody>{visible.map((order) => <tr key={order.order_id} data-selected={order.order_id === selected?.order_id}><td><button id={`order-select-${order.order_id}`} className={styles.orderSelect} aria-pressed={order.order_id === selected?.order_id} onClick={() => { setSelectedId(order.order_id); setFocusRequest(value => value + 1) }}><strong>{order.order_number}</strong><span>{order.student_name}</span></button><small>{orderTime(order.created_at)} · {order.items.reduce((total, item) => total + item.quantity, 0)} items</small></td><td>{order.delivery_building}<small>Floor {order.delivery_floor} · Room {order.delivery_room}</small></td><td><span className={styles.queueStatus}>{orderStatusLabel(order.status)}</span><strong className={styles.queueAmount}>{formatWon(order.total_won)}</strong></td></tr>)}</tbody></table></div>{selected && <FulfillmentOrderDetail key={selected.order_id} order={selected} canOperate={canOperate} focusRequest={selected.order_id === selectedId ? focusRequest : 0} onBack={() => document.getElementById(`order-select-${selected.order_id}`)?.focus()} busy={busy || refreshing || needsRefresh} onAdvance={() => void advance(selected)} />}</div>}
  </main>
}
