'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useState, type ReactNode } from 'react'
import { logoutCustomer } from '@/features/store/client'
import type { CustomerProfile } from '@/features/store/domain'
import { formatWon } from '@/lib/format/currency'
import styles from './store.module.css'

export function StoreBrand() {
  return <Link className={styles.brand} href="/store" aria-label="MICA Money student store">
    <span className={styles.mark} aria-hidden="true">M</span><span>MICA Money<small>Student Store</small></span>
  </Link>
}

export function StoreShell({ session, children }: { session: CustomerProfile; children: ReactNode }) {
  const pathname = usePathname()
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  async function signOut() {
    if (busy) return
    setBusy(true); setError(null)
    try { await logoutCustomer(); router.replace('/store/login'); router.refresh() }
    catch { setError('We couldn’t sign you out. Check your connection and try again.'); setBusy(false) }
  }
  return <div className={styles.page}>
    <a href="#store-content" className={styles.skip}>Skip to content</a>
    <header className={styles.header}>
      <StoreBrand />
      <nav className={styles.nav} aria-label="Student store">
        {[['Shop', '/store'], ['My orders', '/store/orders'], ['Account', '/store/account']].map(([label, href]) => <Link key={href} href={href} aria-current={pathname === href ? 'page' : undefined}>{label}</Link>)}
      </nav>
      <div className={styles.headerWallet}><small>{session.display_name}</small><strong>{formatWon(session.balance_won)}</strong></div>
      <button className={styles.textButton} disabled={busy} onClick={() => void signOut()}>{busy ? 'Signing out…' : 'Sign out'}</button>
    </header>
    <main id="store-content" className={styles.content}>
      {error && <p className={styles.error} role="alert">{error}</p>}
      {children}
    </main>
    <footer className={styles.footer}><strong>MICA Money</strong><span>Card or account help? Visit E202.</span></footer>
  </div>
}
