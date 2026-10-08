type RecoveryStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
function storageKey(operatorId: string): string {
  if (!uuid.test(operatorId)) throw new Error('Invalid recovery owner')
  return `campuspay:stock-adjustment:v1:${operatorId}`
}
export function readPendingAdjustment(storage: RecoveryStorage, operatorId: string): string | null {
  const value = storage.getItem(storageKey(operatorId))
  if (value !== null && !uuid.test(value)) throw new Error('The saved recovery reference is invalid. Do not repeat the stock removal; ask an administrator to investigate.')
  return value
}
export function savePendingAdjustment(storage: RecoveryStorage, operatorId: string, requestId: string): void {
  if (!uuid.test(requestId)) throw new Error('Invalid recovery request')
  const current = readPendingAdjustment(storage, operatorId)
  if (current !== null && current !== requestId) throw new Error('Recover the previous stock removal before starting another.')
  const key = storageKey(operatorId)
  storage.setItem(key, requestId)
  if (storage.getItem(key) !== requestId) throw new Error('Recovery storage is unavailable. No removal was submitted.')
}
export function clearPendingAdjustment(storage: RecoveryStorage, operatorId: string, requestId: string): void {
  const key = storageKey(operatorId)
  const current = readPendingAdjustment(storage, operatorId)
  if (current !== null && current !== requestId) throw new Error('A different stock removal needs recovery. Its reference was preserved.')
  storage.removeItem(key)
  if (storage.getItem(key) !== null) throw new Error('Recovery storage could not be cleared.')
}

/** Serialize read/write publication across tabs sharing the same origin/storage. */
export function withAdjustmentStorageLock<T>(operatorId: string, action: () => T, locks: LockManager | undefined): Promise<T> {
  if (!locks) return Promise.reject(new Error('This browser cannot coordinate safe inventory recovery. Use a current browser; no removal was submitted.'))
  return locks.request(storageKey(operatorId), action)
}
