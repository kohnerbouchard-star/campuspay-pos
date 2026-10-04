'use client'

import { useId, useRef, useState, type ReactNode } from 'react'
import { Dialog } from './Dialog'

/** Presentation only: authorization, version checks and replay safety belong to the server. */
export function ConfirmationDialog({ title, description, confirmLabel, cancelLabel = 'Cancel',
  destructive = false, confirmationText, confirmDisabled = false, children, onConfirm, onCancel,
}: {
  title: string; description: string; confirmLabel: string; cancelLabel?: string
  destructive?: boolean; confirmationText?: string; confirmDisabled?: boolean; children?: ReactNode
  onConfirm(): Promise<void>; onCancel(): void
}) {
  const id = useId(), lock = useRef(false)
  const [typed, setTyped] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState('')
  const allowed = !confirmDisabled && (!confirmationText || typed === confirmationText)
  async function confirm() {
    if (lock.current || !allowed) return
    lock.current = true; setBusy(true); setError('')
    try { await onConfirm() }
    catch { setError('The action could not be confirmed. Check its recorded status before trying again.') }
    finally { lock.current = false; setBusy(false) }
  }
  return <Dialog title={title} busy={busy} onClose={() => { if (!lock.current) onCancel() }}
    role={destructive ? 'alertdialog' : 'dialog'} describedBy={`${id}-description`}>
    <p id={`${id}-description`}>{description}</p>
    {children}
    {confirmationText && <label className="field"><span>Type {confirmationText} to confirm</span>
      <input data-confirmation-text={confirmationText} autoComplete="off" spellCheck={false} value={typed} disabled={busy}
        onChange={event => setTyped(event.target.value)} /></label>}
    {error && <p className="error-message" role="alert">{error}</p>}
    {busy && <p role="status">Applying this action. Keep this window open until its result is confirmed.</p>}
    <div className="action-row end">
      <button data-dialog-initial-focus autoFocus type="button" className="secondary-action" disabled={busy} onClick={onCancel}>{cancelLabel}</button>
      <button type="button" className={`primary-action ${destructive ? 'danger-action' : ''}`}
        disabled={busy || !allowed} onClick={() => void confirm()}>{busy ? 'Applying…' : confirmLabel}</button>
    </div>
  </Dialog>
}
