'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { logout, recordActivity } from '@/features/auth/client'

const EVENTS: (keyof WindowEventMap)[] = ['pointerdown', 'keydown', 'touchstart']

export function useInactivityLock(timeoutMs = 20_000) {
  const [remainingMs, setRemainingMs] = useState(timeoutMs)
  const deadline = useRef(0)
  const lastServerTouch = useRef(0)
  const locking = useRef(false)

  const lock = useCallback(async () => {
    if (locking.current) return
    locking.current = true
    try { await logout() } catch { /* Server expiry remains authoritative. */ }
    window.location.replace('/')
  }, [])

  const noteActivity = useCallback(() => {
    deadline.current = Date.now() + timeoutMs
    setRemainingMs(timeoutMs)
    const now = Date.now()
    if (now - lastServerTouch.current >= 4_000) {
      lastServerTouch.current = now
      void recordActivity().catch(() => lock())
    }
  }, [lock, timeoutMs])

  useEffect(() => {
    deadline.current = Date.now() + timeoutMs
    for (const event of EVENTS) window.addEventListener(event, noteActivity, { passive: true })
    const timer = window.setInterval(() => {
      const remaining = Math.max(0, deadline.current - Date.now())
      setRemainingMs(remaining)
      if (remaining === 0) void lock()
    }, 250)
    return () => {
      for (const event of EVENTS) window.removeEventListener(event, noteActivity)
      window.clearInterval(timer)
    }
  }, [lock, noteActivity, timeoutMs])

  return { remainingMs, noteActivity, warning: remainingMs <= 5_000 }
}
