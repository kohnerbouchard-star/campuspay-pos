import { requireCustomerPage } from '@/features/store/server/page-guard'
import { customerProfile } from '@/features/store/presentation'
import { StoreShell } from '@/features/store/ui/StoreShell'
import { formatWon } from '@/lib/format/currency'
import styles from '@/features/store/ui/store.module.css'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'My account · MICA Store' }
export default async function Page() {
  const session = await requireCustomerPage('/store/account')
  return <StoreShell session={customerProfile(session)}>
    <div className={styles.heading}><p className={styles.eyebrow}>MICA Money</p><h1>My account</h1><p className={styles.muted}>Your wallet and card support, in one place.</p></div>
    <div className={styles.accountGrid}>
      <section className={styles.walletPanel}><span>Wallet balance</span><strong>{formatWon(session.balance_won)}</strong><p>{session.display_name}</p>{session.debt_won > 0 && <small>Amount to repay: {formatWon(session.debt_won)}</small>}<small>Purchases cannot take your balance below −₩15,000.</small></section>
      <section className={styles.panel}><h2>Card &amp; PIN help</h2><p>Visit E202 to add funds, reset your PIN, or replace a lost MICA Money Card.</p><p className={styles.muted}>For your security, a staff member will verify your details before making changes.</p><h3>Room delivery</h3><p>Choose a building, floor, and available room at checkout. Your order will be addressed to {session.display_name}.</p></section>
    </div>
  </StoreShell>
}
