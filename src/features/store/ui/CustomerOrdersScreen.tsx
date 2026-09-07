'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { fetchCustomerOrders } from '@/features/store/client'
import type { CustomerOrder, CustomerProfile } from '@/features/store/domain'
import { customerLoginPath } from '@/features/store/navigation'
import { isCustomerSessionError, storeErrorMessage } from '@/features/store/presentation'
import { StoreShell } from './StoreShell'
import { CustomerOrderCard } from './CustomerOrderCard'
import styles from './store.module.css'

export function CustomerOrdersScreen({ session }: { session: CustomerProfile }) {
  const router = useRouter()
  const [orders, setOrders] = useState<CustomerOrder[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [refresh, setRefresh] = useState(0)
  useEffect(() => {
    let active = true
    fetchCustomerOrders().then((rows) => {
      if (!active) return
      setOrders(rows); setError(null); setLoading(false)
    }).catch((caught: unknown) => {
      if (!active) return
      if (isCustomerSessionError(caught)) { router.replace(customerLoginPath('/store/orders', true)); router.refresh() }
      else { setError(storeErrorMessage(caught)); setLoading(false) }
    })
    return () => { active = false }
  }, [router, refresh])
  return <StoreShell session={session}>
    <div className={styles.headingRow}><div className={styles.heading}><p className={styles.eyebrow}>MICA Money</p><h1>My orders</h1><p className={styles.muted}>Follow your delivery and see your recent purchases.</p></div><button className={styles.secondary} disabled={loading} onClick={() => { setLoading(true); setRefresh((value) => value + 1) }}>{loading ? 'Refreshing…' : 'Refresh orders'}</button></div>
    {error && <p className={styles.error} role="alert">{error}</p>}
    {loading && <p className={styles.notice} role="status">Checking your orders…</p>}
    {!loading && !error && orders.length === 0 && <section className={styles.empty}><h2>Your first order starts here</h2><p>Shop the student store and we’ll deliver to your room.</p><Link className={styles.primary} href="/store">Explore the store</Link></section>}
    <div className={styles.orderList}>{orders.map((order) => <CustomerOrderCard key={order.order_id} order={order} recipient={session.display_name} />)}</div>
  </StoreShell>
}
