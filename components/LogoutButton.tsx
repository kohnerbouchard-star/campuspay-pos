'use client'

import { useState } from 'react'
import { logout } from '@/features/auth/client'

export function LogoutButton() {
  const [busy, setBusy] = useState(false)
  return <button className="secondary-action" disabled={busy} onClick={async () => {
    setBusy(true)
    try { await logout() } finally { window.location.replace('/') }
  }}>{busy ? 'Signing out…' : 'Sign out'}</button>
}
