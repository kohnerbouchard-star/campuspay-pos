'use client'

import { useRef, useState } from 'react'
import { logout } from '@/features/auth/client'

export function LogoutButton({ label = 'Sign out' }: { label?: string }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const flight = useRef(false)
  return <div><button type="button" className="secondary-action" disabled={busy} onClick={async () => {
    if (flight.current) return
    flight.current = true; setBusy(true); setError('')
    try { await logout(); window.location.replace('/') }
    catch { setError('Sign out could not be confirmed. Retry before leaving this device unattended.'); flight.current = false; setBusy(false) }
  }}>{busy ? 'Signing out…' : label}</button>{error && <p className="error-message" role="alert">{error}</p>}</div>
}
