'use client'
import styles from '@/features/store/ui/store.module.css'
export default function StoreError({ reset }: { reset: () => void }) {
  return <main className={styles.loginPage}><section className={styles.loginCard}><p className={styles.eyebrow}>MICA Money</p><h1>We couldn’t open the store</h1><p>Please check your connection and try again.</p><button className={styles.primary} onClick={reset}>Try again</button></section></main>
}
