'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { login } from '@/features/auth/client'

export function LoginForm() {
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
      router.replace(session.workspace)
      router.refresh()
    } catch (e) {
      setPin('')
      setError(e instanceof Error ? e.message : 'Sign-in failed')
    } finally { setBusy(false) }
  }

  return <form className="login-card" onSubmit={submit}>
    <div className="brand-mark">CP</div>
    <div><p className="eyebrow">School wallet system</p><h1>Employee sign in</h1></div>
    <label className="field"><span>Employee ID</span><input autoFocus autoComplete="username" value={employeeCode} onChange={(e) => setEmployeeCode(e.target.value)} /></label>
    <label className="field"><span>Employee PIN</span><input type="password" inputMode="numeric" autoComplete="current-password" value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0,16))} /></label>
    {error && <p className="error-message" role="alert">{error}</p>}
    <button className="primary-action" disabled={busy || employeeCode.length < 2 || pin.length < 4}>{busy ? 'Signing in…' : 'Sign in'}</button>
    <small className="muted">The system opens only the workspace assigned to this employee.</small>
  </form>
}
