'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { logout, recordActivity } from '@/features/auth/client'
import { ClientApiError } from '@/lib/api/client'
import { ACTIVITY_EVENTS, POS_INACTIVITY_MS, RECEIPT_PROTECTION_MS, SESSION_HEARTBEAT_MS, WorkstationActivity } from './inactivity'

type Protection = { key: string; until?: number } | null
export function useInactivityLock(protection: Protection = null, timeoutMs = POS_INACTIVITY_MS, returnPath = '/pos') {
  const [status, setStatus] = useState({ remainingMs: timeoutMs, warning: false })
  const activity = useRef<WorkstationActivity | null>(null)
  const dirty = useRef(true)
  const locking = useRef(false)
  const protectionKey = protection?.key ?? null
  const protectionUntil = protection?.until
  const lock = useCallback(async () => {
    if (locking.current) return
    locking.current = true
    try { await logout() }
    catch {
      // Hide the unattended workspace, but do not claim server revocation.
      window.location.replace(`/login?next=${encodeURIComponent(returnPath)}&logout=unconfirmed`)
      return
    }
    window.location.replace(`/login?next=${encodeURIComponent(returnPath)}&expired=1`)
  }, [returnPath])
  const noteActivity = useCallback(() => {
    if (activity.current?.snapshot(Date.now()).locked) { void lock(); return }
    activity.current?.activity(Date.now())
    dirty.current = true
    setStatus({ remainingMs: timeoutMs, warning: false })
  }, [lock, timeoutMs])
  useEffect(() => {
    const now = Date.now()
    activity.current ??= new WorkstationActivity(now, timeoutMs)
    activity.current.protect(protectionKey, protectionUntil ?? now + RECEIPT_PROTECTION_MS, now)
  }, [protectionKey, protectionUntil, timeoutMs])
  useEffect(() => {
    activity.current ??= new WorkstationActivity(Date.now(), timeoutMs)
    let active = true
    let touching = false
    const touch = async () => {
      if (touching || locking.current || activity.current?.snapshot(Date.now()).locked) return
      if (document.visibilityState !== 'visible' || !navigator.onLine || !dirty.current) return
      touching = true
      dirty.current = false
      try { await recordActivity() }
      catch (error) {
        dirty.current = true
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
  }, [lock, noteActivity, timeoutMs])
  return { ...status, noteActivity }
}
