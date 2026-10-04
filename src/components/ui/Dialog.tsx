'use client'
import { useEffect, useRef, type ReactNode } from 'react'

export function Dialog({ title, children, onClose, busy = false, className = '', role = 'dialog', describedBy }: {
  title: string; children: ReactNode; onClose(): void; busy?: boolean; className?: string; role?: 'dialog' | 'alertdialog'; describedBy?: string
}) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const dialog = ref.current
    const previous = document.activeElement as HTMLElement | null
    dialog?.showModal()
    dialog?.querySelector<HTMLElement>('[data-dialog-initial-focus]')?.focus()
    return () => { dialog?.close(); if(previous?.isConnected && !previous.matches(':disabled')) previous.focus(); else document.getElementById('workspace-content')?.focus() }
  }, [])
  return <dialog ref={ref} className={`dialog ${className}`} tabIndex={-1} role={role} aria-modal="true" aria-describedby={describedBy} aria-label={title} aria-busy={busy}
    onKeyDown={event => {
      if (event.key !== 'Tab') return
      const dialog = event.currentTarget
      const controls = [...dialog.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]')]
        .filter(element => element.tabIndex >= 0 && !element.matches(':disabled') && element.getClientRects().length > 0)
      const first = controls[0], last = controls.at(-1)
      if (!first) { event.preventDefault(); dialog.focus(); return }
      if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog)) { event.preventDefault(); last?.focus() }
      else if (!event.shiftKey && (document.activeElement === last || document.activeElement === dialog)) { event.preventDefault(); first.focus() }
    }}
    onCancel={event => { event.preventDefault(); if (!busy) onClose() }}>
    <div className="panel-heading"><h2>{title}</h2><button className="icon-button" type="button" aria-label="Close dialog" disabled={busy} onClick={onClose}>×</button></div>{children}
  </dialog>
}
