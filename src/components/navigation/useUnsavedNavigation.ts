'use client'

import { useEffect } from 'react'
import { isStaffSessionExiting } from '@/features/terminal/session-exit'

/** Guard client-side links as well as full-page exits. Never cancel server work. */
export function useUnsavedNavigation(dirty: boolean, message: string) {
  useEffect(() => {
    if (!dirty) return
    const warn = (event: BeforeUnloadEvent) => { if (!isStaffSessionExiting()) { event.preventDefault(); event.returnValue = '' } }
    const navigate = (event: MouseEvent) => {
      if (isStaffSessionExiting()) return
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
      const anchor = event.target instanceof Element ? event.target.closest('a[href]') : null
      if (!(anchor instanceof HTMLAnchorElement) || anchor.hasAttribute('download') || anchor.target && anchor.target !== '_self') return
      const destination = new URL(anchor.href, location.href)
      // External links use beforeunload; same-document anchors keep the editor mounted.
      if (destination.origin !== location.origin || destination.pathname === location.pathname && destination.search === location.search) return
      if (!window.confirm(message)) {
        event.preventDefault()
        // Capture before Next Link and mobile-menu handlers can navigate/unmount.
        event.stopImmediatePropagation()
      }
    }
    document.addEventListener('click', navigate, true)
    window.addEventListener('beforeunload', warn)
    return () => {
      document.removeEventListener('click', navigate, true)
      window.removeEventListener('beforeunload', warn)
    }
  }, [dirty, message])
}
