import { ApiError } from '@/lib/api/errors'

/** Only this known receiving constraint establishes an invoice collision.
 * Do not interpret PostgreSQL messages: they can contain submitted values.
 * Unknown SQL errors and response-decoding failures must remain unconfirmed.
 */
export function receiptConflict(error: unknown, rpc: string): ApiError | null {
  if (rpc !== 'receive_stock') return null
  const seen = new Set<unknown>()
  while (error && typeof error === 'object' && !seen.has(error)) {
    seen.add(error)
    const row = error as { code?: unknown; constraint?: unknown; cause?: unknown }
    if (row.code === '23505' && row.constraint === 'stock_receipts_supplier_name_supplier_invoice_key') {
      return new ApiError(409, 'RECEIPT_INVOICE_EXISTS', 'This supplier and invoice already have a recorded receipt. Check the existing receipt; do not enter the same delivery under a different invoice.')
    }
    error = row.cause
  }
  return null
}
