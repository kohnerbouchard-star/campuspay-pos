import { apiFetch } from '@/lib/api/client'
import type { CatalogProduct, CartLine, PaymentIntent, CardScanResult, PaymentReceipt, TenderMode, PaymentPolicy, PaymentRecovery } from '@/features/pos/domain'

export function fetchCatalog() {
  return apiFetch<CatalogProduct[]>('/api/pos/catalog')
}

export function openPaymentIntent(items: CartLine[], couponCode: string | null = null, tenderMode: TenderMode = 'WALLET', walletAmountWon: number | null = null, idempotencyKey = crypto.randomUUID()) {
  return apiFetch<PaymentIntent>('/api/pos/intents', {
    method: 'POST',
    body: JSON.stringify({ items, couponCode, tenderMode, walletAmountWon, idempotencyKey }),
  })
}

export function submitCard(intentId: string, cardRead: string) {
  return apiFetch<CardScanResult>(`/api/pos/intents/${intentId}/card`, {
    method: 'POST', body: JSON.stringify({ cardRead }),
  })
}

export function submitStudentPin(intentId: string, pin: string | null, cashReceivedWon: number | null = null) {
  return apiFetch<PaymentReceipt>(`/api/pos/intents/${intentId}/confirm`, {
    method: 'POST', signal: AbortSignal.timeout(30_000), body: JSON.stringify({ pin, cashReceivedWon }),
  })
}

export const fetchPaymentPolicy = () => apiFetch<PaymentPolicy>('/api/pos/payment-policy')
export const savePaymentPolicy = (cashEnabled: boolean, eventName: string | null, endsAt: string | null) => apiFetch<PaymentPolicy>('/api/pos/payment-policy', { method: 'POST', body: JSON.stringify({ cashEnabled, eventName, endsAt }) })
export const cancelPaymentIntent = (intentId: string) => apiFetch<{ cancelled: boolean }>(`/api/pos/intents/${intentId}/cancel`, { method: 'POST', body: '{}' })

export const recoverPaymentIntent = (intentId: string) => apiFetch<PaymentRecovery>(`/api/pos/intents/${intentId}/recover`, { method: 'POST', body: '{}' })

export const submitTenderPlan = (intentId: string, walletAmountWon: number) => apiFetch<PaymentIntent>(`/api/pos/intents/${intentId}/tender`, { method: 'POST', body: JSON.stringify({ walletAmountWon }) })
