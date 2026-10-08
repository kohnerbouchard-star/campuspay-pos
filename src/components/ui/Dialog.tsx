'use client'
import { useEffect, useRef, type ReactNode } from 'react'
import { isStaffSessionExiting } from '@/features/terminal/session-exit'

export function Dialog({ title, children, onClose, busy = false, className = '', role = 'dialog', describedBy, returnFocus }: {
  title: string; children: ReactNode; onClose(): void; busy?: boolean; className?: string; role?: 'dialog' | 'alertdialog'; describedBy?: string; returnFocus?(): void
}) {
  const ref = useRef<HTMLDialogElement>(null)
  const restore = useRef(returnFocus)
  useEffect(() => { restore.current = returnFocus }, [returnFocus])
  useEffect(() => {
    const dialog = ref.current
    const previous = document.activeElement as HTMLElement | null
    if (isStaffSessionExiting()) return
    dialog?.showModal()
    dialog?.querySelector<HTMLElement>('[data-dialog-initial-focus]')?.focus()
    return () => { dialog?.close(); if (isStaffSessionExiting()) return; if (restore.current) { restore.current(); return }; if(previous?.isConnected && !previous.matches(':disabled')) previous.focus({ preventScroll: true }); else document.getElementById('workspace-content')?.focus() }
  }, [])
  return <dialog ref={ref} className={`dialog ${className}`} tabIndex={-1} role={role} aria-modal="true" aria-describedby={describedBy} aria-label={title} aria-busy={busy}
    onKeyDown={event => {
      if (event.key !== 'Tab' || (event.target as Element).closest('dialog') !== event.currentTarget) return
      const dialog = event.currentTarget
      const controls = [...dialog.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, summary, [tabindex]')]
        .filter(element => {
          if (element.tabIndex < 0 || element.matches(':disabled') || element.closest('[inert]') || element.closest('dialog') !== dialog || element.getClientRects().length === 0) return false
          const visibility = getComputedStyle(element).visibility
          if (visibility === 'hidden' || visibility === 'collapse') return false
          // Collapsed details descendants may still have layout rectangles in
          // Chromium. Only their first summary is in the keyboard focus order.
          for (let ancestor = element.parentElement; ancestor && ancestor !== dialog; ancestor = ancestor.parentElement) {
            if (ancestor instanceof HTMLDetailsElement && !ancestor.open && !ancestor.querySelector(':scope > summary')?.contains(element)) return false
          }
          return true
        })
      const first = controls[0], last = controls.at(-1)
      if (!first) { event.preventDefault(); dialog.focus(); return }
      if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog)) { event.preventDefault(); last?.focus() }
      else if (!event.shiftKey && (document.activeElement === last || document.activeElement === dialog)) { event.preventDefault(); first.focus() }
    }}
    onCancel={event => { event.preventDefault(); event.stopPropagation(); if (!busy) onClose() }}>
    <div className="panel-heading"><h2>{title}</h2><button className="icon-button" type="button" aria-label="Close dialog" disabled={busy} onClick={onClose}>×</button></div>{children}
  </dialog>
}
