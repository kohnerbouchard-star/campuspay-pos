/** Reference-only recovery remains available even when an old draft is invalid. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
export const receiptStorageKey = (userId: string) => `mica-money:pending-stock-receipt:${userId}`
export function savedReceiptReference(value: unknown): string | null {
  return record(value) && typeof value.idempotencyKey === 'string' && UUID.test(value.idempotencyKey) ? value.idempotencyKey : null
}
export function confirmedStockReceipt(value: unknown): value is { receipt_id: string; receipt_number: string; total_quantity: number; purchase_subtotal_won: number; total_landed_cost_won: number; created_at: string } {
  if (!record(value)) return false
  return typeof value.receipt_id === 'string' && UUID.test(value.receipt_id)
    && typeof value.receipt_number === 'string' && value.receipt_number.trim().length > 0 && value.receipt_number.length <= 120
    && typeof value.created_at === 'string' && Number.isFinite(Date.parse(value.created_at))
    && typeof value.total_quantity === 'number' && Number.isSafeInteger(value.total_quantity) && value.total_quantity > 0
    && ['purchase_subtotal_won', 'total_landed_cost_won'].every(key => typeof value[key] === 'number' && Number.isSafeInteger(value[key]) && value[key] >= 0)
}
export type ReceiptRecoveryIssue = { message: string; needsSignIn: boolean }
type ApplicationFailure = { code: string; status: number; message: string }
export function receiptRecoveryIssue(error: ApplicationFailure | null): ReceiptRecoveryIssue {
  if (error && error.status < 500 && ['UNAUTHENTICATED', 'SESSION_EXPIRED'].includes(error.code)) return {
    message: 'Your staff session ended. Sign in with the same employee account in this browser, then check the saved receipt. Do not clear site data or create another receipt.', needsSignIn: true,
  }
  if (error?.code === 'FORBIDDEN' && error.status === 403) return {
    message: 'Access to this receipt was denied. Use the employee account and original browser/register that submitted it. If the original register is unavailable, give the saved request reference to a Super Admin. Do not record the stock again.', needsSignIn: false,
  }
  if (error?.code === 'DATABASE_UPGRADE_REQUIRED') return { message: 'The database needs an update before receipt recovery can continue. Give the saved request reference to a Super Admin; keep this request saved.', needsSignIn: false }
  if (error?.code === 'RECEIPT_INVOICE_EXISTS') return { message: 'This supplier and invoice already have a recorded receipt. Do not rename the invoice or enter the delivery again. Keep the saved request reference and ask a Super Admin to reconcile it with the existing receipt.', needsSignIn: false }
  if (error?.status === 400 || error?.status === 409) return {
    message: 'The original request could not be completed. Keep its saved reference and ask a Super Admin to reconcile it with the receipt history. A failed retry does not prove an earlier attempt failed.', needsSignIn: false,
  }
  return { message: 'The server could not confirm this receipt. Check its status again using the same saved reference. No new stock is submitted by a status check.', needsSignIn: false }
}
type ReceiptStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>
export function persistReceipt(storage: ReceiptStorage, userId: string, raw: string): void {
  const key = receiptStorageKey(userId)
  if (storage.getItem(key) !== null) throw new Error('A saved receipt already needs recovery')
  storage.setItem(key, raw)
  if (storage.getItem(key) !== raw) throw new Error('The receipt reference could not be saved')
}
export function forgetConfirmedReceipt(storage: ReceiptStorage, userId: string, reference: string): void {
  const key = receiptStorageKey(userId), raw = storage.getItem(key)
  if (raw === null) return
  if (savedReceiptReference(JSON.parse(raw)) !== reference) throw new Error('Another saved receipt needs recovery')
  storage.removeItem(key)
  if (storage.getItem(key) !== null) throw new Error('The saved reference could not be cleared')
}
