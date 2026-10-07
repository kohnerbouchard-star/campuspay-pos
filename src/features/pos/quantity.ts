/** The same per-product bound is used by client controls and server validation. */
export const MAX_CART_QUANTITY = 99

export function quantityLimit(stock: number): number {
  return Number.isFinite(stock) ? Math.max(0, Math.min(MAX_CART_QUANTITY, Math.floor(stock))) : 0
}

export function boundedQuantity(value: number, stock: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.min(Math.floor(value), quantityLimit(stock))) : 0
}
