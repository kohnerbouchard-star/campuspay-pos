import { apiFetch } from '@/lib/api/client'
import type { CatalogProduct, CartLine, PaymentIntent, CardScanResult, PaymentReceipt } from '@/features/pos/domain'

export function fetchCatalog() {
  return apiFetch<CatalogProduct[]>('/api/pos/catalog')
}

export function openPaymentIntent(items: CartLine[], couponCode: string | null = null) {
  return apiFetch<PaymentIntent>('/api/pos/intents', {
    method: 'POST',
    body: JSON.stringify({ items, couponCode, idempotencyKey: crypto.randomUUID() }),
  })
}

export function submitCard(intentId: string, cardRead: string) {
  return apiFetch<CardScanResult>(`/api/pos/intents/${intentId}/card`, {
    method: 'POST', body: JSON.stringify({ cardRead }),
  })
}

export function submitStudentPin(intentId: string, pin: string) {
  return apiFetch<PaymentReceipt>(`/api/pos/intents/${intentId}/confirm`, {
    method: 'POST', body: JSON.stringify({ pin }),
  })
}
