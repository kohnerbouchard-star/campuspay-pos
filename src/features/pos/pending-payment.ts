const KEY = 'campuspay.pendingPayment'
/** Only an opaque sale proposal ID is retained. Never store card data or a PIN. */
export function rememberPendingPayment(intentId: string) {
  try { sessionStorage.setItem(KEY, intentId); return sessionStorage.getItem(KEY) === intentId }
  catch { return false }
}
export function readPendingPayment() {
  try { const value = sessionStorage.getItem(KEY); return value && /^[a-f0-9-]{36}$/i.test(value) ? value : null }
  catch { return null }
}
export function forgetPendingPayment() { try { sessionStorage.removeItem(KEY) } catch { /* Recovery is idempotent if a stale marker remains. */ } }
