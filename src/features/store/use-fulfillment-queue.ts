'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import { fetchStaffOnlineOrders } from './client'
import type { StaffOnlineOrder } from './domain'

export const FULFILLMENT_POLL_MS = 20_000

export function useFulfillmentQueue() {
  const [orders, setOrders] = useState<StaffOnlineOrder[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [needsRefresh, setNeedsRefresh] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const fetchingRef = useRef(false)
  const updatingRef = useRef(false)
  const active = useRef(true)
  const refresh = useCallback(async (afterMutation = false) => {
    if (fetchingRef.current || (updatingRef.current && !afterMutation)) return
    fetchingRef.current = true; setRefreshing(true)
    try {
      const data = await fetchStaffOnlineOrders()
      if (!active.current) return
      setOrders(data); setError(null); setNeedsRefresh(false)
      setSelectedId(current => current ?? data[0]?.order_id ?? null)
    } catch {
      if (active.current) { setNeedsRefresh(true); setError('Orders could not be loaded. Refresh before updating an order.') }
    } finally {
      fetchingRef.current = false
      if (active.current) { setLoading(false); setRefreshing(false) }
    }
  }, [])
  useEffect(() => {
    active.current = true
    void Promise.resolve().then(() => { if (active.current) void refresh() })
    const poll = () => {
      if (document.visibilityState === 'visible' && navigator.onLine) void refresh()
    }
    const timer = window.setInterval(poll, FULFILLMENT_POLL_MS)
    document.addEventListener('visibilitychange', poll)
    window.addEventListener('online', poll)
    return () => { active.current = false; window.clearInterval(timer); document.removeEventListener('visibilitychange', poll); window.removeEventListener('online', poll) }
  }, [refresh])
  return { orders, error, setError, loading, refreshing, needsRefresh, selectedId, setSelectedId, refresh, fetchingRef, updatingRef }
}
