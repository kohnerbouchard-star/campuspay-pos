const KEY = 'campuspay.pendingAdjustment'
export function saveAdjustment(id: string) {
  try { sessionStorage.setItem(KEY, id); return sessionStorage.getItem(KEY) === id } catch { return false }
}
export function pendingAdjustment() {
  try { const value = sessionStorage.getItem(KEY); return value && /^[a-f0-9-]{36}$/i.test(value) ? value : null } catch { return null }
}
export function clearAdjustment() { try { sessionStorage.removeItem(KEY) } catch { /* An obsolete marker is safe to recover again. */ } }
