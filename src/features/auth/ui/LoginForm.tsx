'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { login } from '@/features/auth/client'
import { safeStaffReturn } from '@/features/auth/return-path'
import { Icon } from '@/components/ui/Icon'

export function LoginForm({ destination, expired = false }: { destination?: string; expired?: boolean }) {
  const router = useRouter()
  const [employeeCode, setEmployeeCode] = useState('')
  const [pin, setPin] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError(null)
    try {
      const session = await login(employeeCode, pin)
      setPin('')
      router.replace(safeStaffReturn(destination, session.permissions, session.workspace))
      router.refresh()
    } catch (e) {
      setPin('')
      setError(e instanceof Error ? e.message : 'Sign-in failed')
    } finally { setBusy(false) }
  }

  return <form className="login-card" onSubmit={submit} aria-busy={busy}>
    <div className="login-form-heading"><span className="login-form-mark" aria-hidden="true"><Icon name="shield" size={24} /></span><p className="eyebrow">MICA staff operations</p><h1>Staff sign in</h1><p className="muted">Use your employee ID and personal PIN.</p></div>
    {expired && <p role="status" className="notice">Your session ended. Sign in to continue.</p>}
    <label className="field"><span>Employee ID</span><input required autoFocus autoComplete="username" maxLength={32} aria-describedby={error ? 'staff-login-error' : undefined} disabled={busy} value={employeeCode} onChange={(e) => setEmployeeCode(e.target.value)} /></label>
    <label className="field"><span>Employee PIN</span><input required type="password" inputMode="numeric" autoComplete="current-password" aria-describedby={error ? 'staff-login-error' : undefined} disabled={busy} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0,16))} /></label>
    {error && <p id="staff-login-error" className="error-message" role="alert">{error}</p>}
    <button className="primary-action" disabled={busy || employeeCode.length < 2 || pin.length < 4}>{busy ? 'Signing in…' : 'Sign in'}</button>
    <small className="muted login-access-note"><Icon name="shield" size={16} />Need help with access? Contact your school administrator.</small>
  </form>
}
