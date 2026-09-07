import { apiFetch } from '@/lib/api/client'
import type { StudentWalletSummary, AdjustmentIntent, AdjustmentCardResult, AdjustmentReceipt } from '@/features/wallets/domain'

export function searchWallets(query: string) {
  return apiFetch<StudentWalletSummary[]>(`/api/accounting/students?q=${encodeURIComponent(query)}`)
}
export function openAdjustment(input: {
  direction: 'CREDIT'|'DEBIT'; denominations: number[]; reasonCode: string; notes: string; idempotencyKey?: string
}) {
  return apiFetch<AdjustmentIntent>('/api/accounting/intents', {
    method: 'POST', body: JSON.stringify({ ...input, idempotencyKey: input.idempotencyKey ?? crypto.randomUUID() }),
  })
}
export function scanAdjustmentCard(intentId: string, cardRead: string) {
  return apiFetch<AdjustmentCardResult>(`/api/accounting/intents/${intentId}/card`, {
    method: 'POST', body: JSON.stringify({ cardRead }),
  })
}
export function confirmAdjustment(intentId: string, pin: string) {
  return apiFetch<AdjustmentReceipt>(`/api/accounting/intents/${intentId}/confirm`, {
    method: 'POST', body: JSON.stringify({ pin }),
  })
}
export function recoverAdjustment(intentId: string) {
  return apiFetch<{ state: 'completed' | 'cancelled'; receipt: AdjustmentReceipt | null }>(`/api/accounting/intents/${intentId}/recover`, { method: 'POST', body: '{}' })
}
