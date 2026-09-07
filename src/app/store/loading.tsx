import styles from '@/features/store/ui/store.module.css'
export default function StoreLoading() {
  return <main className={styles.loginPage}><p className={styles.muted} role="status">Opening MICA Money…</p></main>
}
