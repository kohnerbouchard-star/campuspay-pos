import { apiFetch } from '@/lib/api/client'
import { withStoreTimeout } from '@/features/store/request-timeout'
import type { CatalogProduct } from '@/features/pos/domain'
import type {
  CustomerOrder, CustomerSession, DeliveryLocation, OnlineOrderReceipt, OnlineOrderQuote, StaffOnlineOrder,
} from '@/features/store/domain'

export function fetchStoreCatalog() { return apiFetch<CatalogProduct[]>('/api/store/catalog') }
export function fetchDeliveryLocations() { return apiFetch<DeliveryLocation[]>('/api/store/locations') }
export function fetchCustomerSession() { return apiFetch<CustomerSession>('/api/store/session') }
export function loginCustomer(cardNumber: string, pin: string) {
  return apiFetch<CustomerSession>('/api/store/login', { method: 'POST', body: JSON.stringify({ cardNumber, pin }) })
}
export function logoutCustomer() { return apiFetch<{ signedOut: true }>('/api/store/logout', { method: 'POST', body: '{}' }) }
export function placeOnlineOrder(input: {
  items: { productId: string; quantity: number }[]
  couponCode: string | null
  deliveryLocationId: string
  deliveryNote: string | null
  idempotencyKey: string
  expectedTotalWon?: number
}) {
  return withStoreTimeout(signal => apiFetch<OnlineOrderReceipt>('/api/store/orders', {
    method: 'POST', signal,
    body: JSON.stringify(input),
  }))
}
export function quoteCustomerOrder(items: { productId: string; quantity: number }[], couponCode: string | null) {
  return withStoreTimeout(signal => apiFetch<OnlineOrderQuote>('/api/store/quote', { method: 'POST', signal, body: JSON.stringify({ items, couponCode }) }))
}
export function fetchCustomerOrders() { return apiFetch<CustomerOrder[]>('/api/store/orders') }
export function recoverCustomerOrder(idempotencyKey: string) {
  return withStoreTimeout(signal => apiFetch<OnlineOrderReceipt | null>('/api/store/orders/recover', { method: 'POST', signal, body: JSON.stringify({ idempotencyKey }) }))
}
export function fetchStaffOnlineOrders() { return apiFetch<StaffOnlineOrder[]>('/api/orders') }
export function advanceOnlineOrder(orderId: string, status: 'PICKING'|'READY'|'OUT_FOR_DELIVERY'|'DELIVERED') {
  return apiFetch(`/api/orders/${orderId}/status`, { method: 'POST', body: JSON.stringify({ status }) })
}
