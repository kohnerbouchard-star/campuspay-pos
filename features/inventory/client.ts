import { apiFetch } from '@/lib/api/client'
import type { InventoryLot } from '@/features/inventory/domain'

export type ProductInput = { sku: string; name: string; category: string; sellingPriceWon: number; reorderLevel: number }
export type ReceiptInput = {
  supplierName: string; supplierInvoice: string; purchaseDate: string;
  shippingWon: number; otherCostsWon: number; discountWon: number; notes?: string;
  lines: Array<{ productId: string; quantity: number; purchaseUnitCostWon: number; expirationDate?: string | null; supplierLotCode?: string | null }>
}

export function fetchLots() { return apiFetch<InventoryLot[]>('/api/inventory/lots') }
export function addProduct(input: ProductInput) {
  return apiFetch('/api/inventory/products', { method: 'POST', body: JSON.stringify(input) })
}
export function postReceipt(input: ReceiptInput) {
  return apiFetch('/api/inventory/receipts', {
    method: 'POST', body: JSON.stringify({ ...input, idempotencyKey: crypto.randomUUID() }),
  })
}
