import { z } from 'zod'
import { OnlineOrderQuoteSchema, PlaceOnlineOrderSchema } from '@/features/store/domain'

const PendingOrderSchema = z.object({
  version: z.literal(1),
  studentId: z.string().uuid(),
  order: z.object({
    input: PlaceOnlineOrderSchema.omit({ idempotencyKey: true, expectedTotalWon: true }).extend({
      couponCode: z.string().nullable(), deliveryNote: z.string().max(240).nullable(),
    }),
    quote: OnlineOrderQuoteSchema,
    idempotencyKey: z.string().uuid(),
  }),
})
export type RecoverableOrder = z.infer<typeof PendingOrderSchema>['order']
const storageKey = (studentId: string) => `mica-money:pending-order:${studentId}`

export function parsePendingOrder(raw: string | null, studentId: string): RecoverableOrder | null {
  if (!raw) return null
  try {
    const result = PendingOrderSchema.safeParse(JSON.parse(raw))
    return result.success && result.data.studentId === studentId ? result.data.order : null
  } catch { return null }
}

export function readPendingOrder(studentId: string): RecoverableOrder | null {
  if (typeof window === 'undefined') return null
  try { return parsePendingOrder(window.sessionStorage.getItem(storageKey(studentId)), studentId) }
  catch { return null }
}

/** Persist before submitting; failure prevents starting an unrecoverable payment. */
export function savePendingOrder(studentId: string, order: RecoverableOrder): void {
  const pending = PendingOrderSchema.parse({ version: 1, studentId, order })
  window.sessionStorage.setItem(storageKey(studentId), JSON.stringify(pending))
}

export function clearPendingOrder(studentId: string): void {
  try { window.sessionStorage.removeItem(storageKey(studentId)) } catch { /* A retained key can only replay the existing order. */ }
}
