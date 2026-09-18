import { RecoverRefundSchema } from './domain'
type RecoveryStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>
export const REFUND_RECOVERY_KEY = 'campuspay:refund:v1'
export function readRefundRecovery(storage: RecoveryStorage) {
  const raw = storage.getItem(REFUND_RECOVERY_KEY)
  return raw === null ? null : RecoverRefundSchema.parse(JSON.parse(raw))
}
export function saveRefundRecovery(storage: RecoveryStorage, saleId: string, idempotencyKey: string) {
  const value = JSON.stringify(RecoverRefundSchema.parse({ saleId, idempotencyKey }))
  storage.setItem(REFUND_RECOVERY_KEY, value)
  if (storage.getItem(REFUND_RECOVERY_KEY) !== value) throw new Error('Recovery storage unavailable')
}
export function clearRefundRecovery(storage: RecoveryStorage) { storage.removeItem(REFUND_RECOVERY_KEY) }
