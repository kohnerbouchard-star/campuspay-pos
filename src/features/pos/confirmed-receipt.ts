import type { PaymentReceipt, PaymentRecovery } from '@/features/pos/domain'

/** Never print catalog prices or invented adjustments as a confirmed sale. The
 * recovery RPC returns the original immutable sale-item snapshots, not refunds. */
export function confirmedReceipt(result: PaymentRecovery, expected?: PaymentReceipt): PaymentRecovery | null {
  if (result.state === 'cancelled' && !result.receipt && !expected) return null
  const receipt = result.receipt
  if (result.state !== 'completed' || !receipt || !result.items.length
    || (expected && (receipt.sale_id !== expected.sale_id || receipt.subtotal_won !== expected.subtotal_won
      || receipt.discount_won !== expected.discount_won || receipt.total_won !== expected.total_won))
    || result.items.some(item => !Number.isSafeInteger(item.quantity) || item.quantity <= 0
      || !Number.isSafeInteger(item.lineTotalWon) || item.lineTotalWon < 0)
    || result.items.reduce((total, item) => total + item.lineTotalWon, 0) !== receipt.subtotal_won) {
    throw new Error('Confirmed sale details are not yet available. Recover the original payment; do not charge it again.')
  }
  // Do not recompute discounts, tender totals, rounding or refund adjustments.
  return result
}
