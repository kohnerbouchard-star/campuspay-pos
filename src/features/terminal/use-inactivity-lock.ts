'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { logout, recordActivity } from '@/features/auth/client'
import { ClientApiError } from '@/lib/api/client'
import { ACTIVITY_EVENTS, POS_INACTIVITY_MS, RECEIPT_PROTECTION_MS, SESSION_HEARTBEAT_MS, WorkstationActivity } from './inactivity'

type Protection = { key: string; until?: number } | null
export function useInactivityLock(protection: Protection = null) {
  const [status, setStatus] = useState({ remainingMs: POS_INACTIVITY_MS, warning: false })
  const activity = useRef<WorkstationActivity | null>(null)
  const locking = useRef(false)
  const protectionKey = protection?.key ?? null
  const protectionUntil = protection?.until
  const lock = useCallback(async () => {
    if (locking.current) return
    locking.current = true
    try { await logout() } catch { /* Server expiry remains authoritative. */ }
    window.location.replace('/login?next=%2Fpos&expired=1')
  }, [])
  const noteActivity = useCallback(() => {
    activity.current?.activity(Date.now())
    setStatus({ remainingMs: POS_INACTIVITY_MS, warning: false })
  }, [])
  useEffect(() => {
    const now = Date.now()
    activity.current ??= new WorkstationActivity(now)
    activity.current.protect(protectionKey, protectionUntil ?? now + RECEIPT_PROTECTION_MS, now)
  }, [protectionKey, protectionUntil])
  useEffect(() => {
    activity.current ??= new WorkstationActivity(Date.now())
    let active = true
    let touching = false
    const touch = async () => {
      if (touching || locking.current || activity.current?.snapshot(Date.now()).locked) return
      touching = true
      try { await recordActivity() }
      catch (error) {
        // A heartbeat never revives an expired/revoked session. Transient service
        // failures do not get presented as credential failures; the next RPC checks again.
        if (active && error instanceof ClientApiError && ['SESSION_EXPIRED', 'UNAUTHENTICATED', 'FORBIDDEN'].includes(error.code)) void lock()
      } finally { touching = false }
    }
    for (const event of ACTIVITY_EVENTS) window.addEventListener(event, noteActivity, { passive: true })
    void touch()
    const heartbeat = window.setInterval(() => void touch(), SESSION_HEARTBEAT_MS)
    const timer = window.setInterval(() => {
      const next = activity.current!.snapshot(Date.now())
      setStatus(next)
      if (next.locked) void lock()
    }, 250)
    return () => {
      active = false
      for (const event of ACTIVITY_EVENTS) window.removeEventListener(event, noteActivity)
      window.clearInterval(timer); window.clearInterval(heartbeat)
    }
  }, [lock, noteActivity])
  return { ...status, noteActivity }
}
