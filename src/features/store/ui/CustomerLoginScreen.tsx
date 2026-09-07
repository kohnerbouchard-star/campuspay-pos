'use client'

import { useRef, useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { ClientApiError } from '@/lib/api/client'
import { loginCustomer } from '@/features/store/client'
import { safeCustomerDestination } from '@/features/store/navigation'
import { StoreBrand } from './StoreShell'
import styles from './store.module.css'

export function CustomerLoginScreen({ destination, expired }: { destination: string; expired: boolean }) {
  const router = useRouter()
  const submitting = useRef(false)
  const [cardNumber, setCardNumber] = useState('')
  const [pin, setPin] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  async function signIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (submitting.current) return
    submitting.current = true; setBusy(true); setError(null)
    try {
      await loginCustomer(cardNumber.trim(), pin)
      setPin('')
      router.replace(safeCustomerDestination(destination)); router.refresh()
    } catch (caught) {
      setPin('')
      if (caught instanceof ClientApiError && [400, 401, 429].includes(caught.status)) {
        setError('We couldn’t verify those MICA Money credentials. Check your card information and PIN and try again. Sign-in may be temporarily locked; wait a few minutes or visit E202 for help.')
      } else {
        setError('We couldn’t connect to MICA Money. Check your connection and try again.')
      }
      submitting.current = false; setBusy(false)
    }
  }
  return <main className={styles.loginPage}>
    <div className={styles.loginWrap}>
      <StoreBrand />
      <section className={styles.loginCard} aria-labelledby="customer-login-title">
        <p className={styles.eyebrow}>Your school. Your store.</p>
        <h1 id="customer-login-title">Sign in to MICA Money</h1>
        <p className={styles.muted}>Use your MICA Money Card information and PIN to access the online student store.</p>
        {expired && !error && <p className={styles.notice} role="status">Your session has ended. Sign in again to continue where you left off.</p>}
        <form className={styles.form} onSubmit={(event) => void signIn(event)} aria-busy={busy}>
          <label className={styles.field} htmlFor="customer-card">Card number<input id="customer-card" name="username" autoComplete="username" autoCapitalize="none" spellCheck={false} required minLength={6} maxLength={128} value={cardNumber} onChange={(event) => setCardNumber(event.target.value)} disabled={busy} aria-describedby={error ? 'customer-login-error card-help' : 'card-help'} /></label>
          <small id="card-help" className={styles.muted}>The number printed on your MICA Money Card.</small>
          <label className={styles.field} htmlFor="customer-pin">PIN<input id="customer-pin" name="password" type="password" inputMode="numeric" autoComplete="current-password" required minLength={4} maxLength={12} pattern="[0-9]{4,12}" value={pin} onChange={(event) => setPin(event.target.value.replace(/\D/g, '').slice(0, 12))} disabled={busy} aria-describedby={error ? 'customer-login-error' : undefined} /></label>
          {error && <p id="customer-login-error" className={styles.error} role="alert">{error}</p>}
          <button className={styles.primary} type="submit" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
        </form>
      </section>
      <section className={styles.enrollmentInfo}>
        <h2>Don’t have a MICA Money Card?</h2>
        <p>Visit <strong>E202</strong> to sign up for a new MICA Money Card and activate access to the online store.</p>
        <details><summary>How to get a MICA Money Card</summary><h3>New to MICA Money?</h3><p>Visit E202 to register for a new MICA Money Card. Once your card has been created and activated, return here and sign in to use the online student store.</p></details>
      </section>
    </div>
  </main>
}
