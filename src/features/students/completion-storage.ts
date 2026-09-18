import { z } from 'zod'

type RecoveryStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>
const uuid = z.string().uuid()
function storageKey(studentId: string) { return `campuspay:roster-completion:v1:${uuid.parse(studentId)}` }

// Only opaque IDs are retained. Never store a name, Year, card, PIN, proof or request body.
export function readPendingCompletion(storage: RecoveryStorage, studentId: string): string | null {
  const key = storageKey(studentId)
  const raw = storage.getItem(key)
  if (raw === null) return null
  if (!uuid.safeParse(raw).success) { storage.removeItem(key); return null }
  return raw
}
export function savePendingCompletion(storage: RecoveryStorage, studentId: string, requestId: string) {
  const key = storageKey(studentId)
  storage.setItem(key, uuid.parse(requestId))
  if (storage.getItem(key) !== requestId) throw new Error('Recovery storage is unavailable')
}
export function clearPendingCompletion(storage: RecoveryStorage, studentId: string) { storage.removeItem(storageKey(studentId)) }
