'use client'

import { flushSync } from 'react-dom'

let exiting = false
const listeners = new Set<() => void>()
export const isStaffSessionExiting = () => exiting
export const subscribeSessionExit = (listener: () => void) => {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

/** Conceal locally before awaiting revocation. This does not claim server logout. */
export function beginStaffSessionExit() {
  if (exiting) return
  // Native top-layer dialogs must not remain above the concealed workspace.
  document.querySelectorAll<HTMLDialogElement>('dialog[open]').forEach(dialog => dialog.close())
  flushSync(() => { exiting = true; listeners.forEach(listener => listener()) })
}
