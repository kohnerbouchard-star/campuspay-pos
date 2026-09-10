import { z } from 'zod'

const PendingOrderSchema = z.object({ version: z.literal(2), studentId: z.string().uuid(), idempotencyKey: z.string().uuid() }).strict()
export type RecoverableOrder = Pick<z.infer<typeof PendingOrderSchema>, 'idempotencyKey'>
const prefix = 'mica-money:pending-order:'
const storageKey = (studentId: string) => `${prefix}${studentId}`

export function parsePendingOrder(raw: string | null, studentId: string): RecoverableOrder | null {
  if (!raw) return null
  try {
    const input = JSON.parse(raw)
    // Migrate old proposals by discarding every field except the recovery IDs.
    const result = PendingOrderSchema.safeParse(input.version === 1
      ? { version: 2, studentId: input.studentId, idempotencyKey: input.order?.idempotencyKey } : input)
    return result.success && result.data.studentId === studentId ? { idempotencyKey: result.data.idempotencyKey } : null
  } catch { return null }
}

/** Scrub legacy proposals for every student, including another student's stale
 * metadata. Only unresolved opaque keys survive; they cannot reveal an order
 * without that student's server-authenticated session.
 */
export function scrubPendingOrderStorage(): void {
  try {
    const storage = window.sessionStorage
    for (const key of Object.keys(storage).filter(key => key.startsWith(prefix))) {
      const studentId = key.slice(prefix.length)
      const pending = parsePendingOrder(storage.getItem(key), studentId)
      if (pending) savePendingOrder(studentId, pending)
      else storage.removeItem(key)
    }
  } catch { /* Never lose an uncertain transaction on a storage failure. */ }
}

export function readPendingOrder(studentId: string): RecoverableOrder | null {
  if (typeof window === 'undefined') return null
  scrubPendingOrderStorage()
  try { return parsePendingOrder(window.sessionStorage.getItem(storageKey(studentId)), studentId) }
  catch { return null }
}

/** Persist before submitting; failure prevents starting an unrecoverable payment. */
export function savePendingOrder(studentId: string, order: RecoverableOrder): void {
  const pending = PendingOrderSchema.parse({ version: 2, studentId, idempotencyKey: order.idempotencyKey })
  window.sessionStorage.setItem(storageKey(studentId), JSON.stringify(pending))
}

export function clearPendingOrder(studentId: string): void {
  try { window.sessionStorage.removeItem(storageKey(studentId)) } catch { /* A retained key can only recover the existing outcome. */ }
}
