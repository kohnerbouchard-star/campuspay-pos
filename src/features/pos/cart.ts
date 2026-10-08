import type { CartLine, CatalogProduct } from '@/features/pos/domain'
import { boundedQuantity, quantityLimit } from '@/features/pos/quantity'

export type CartState = Readonly<Record<string, number>>

export function addProduct(cart: CartState, product: CatalogProduct): CartState {
  return changeQuantity(cart, product.id, product.sold_out ? 0 : 1, product.sold_out ? 0 : product.stock_on_hand)
}

export function changeQuantity(cart: CartState, productId: string, delta: number, max: number): CartState {
  if (!Number.isFinite(delta)) return cart
  const next = boundedQuantity((cart[productId] ?? 0) + delta, max)
  if (next === (cart[productId] ?? 0)) return cart
  if (next === 0) {
    const copy = { ...cart }
    delete copy[productId]
    return copy
  }
  return { ...cart, [productId]: next }
}

/** Reconcile refreshed stock without retaining absent, sold-out or oversized lines. */
export function reconcileCart(cart: CartState, products: CatalogProduct[]): CartState {
  const byId = new Map(products.map(product => [product.id, product]))
  let next = cart
  for (const id of Object.keys(cart)) {
    const product = byId.get(id)
    next = changeQuantity(next, id, 0, !product || product.sold_out ? 0 : quantityLimit(product.stock_on_hand))
  }
  return next
}

export function toCartLines(cart: CartState): CartLine[] {
  return Object.entries(cart).map(([productId, quantity]) => ({ productId, quantity }))
}

export function cartTotal(cart: CartState, products: CatalogProduct[]): number {
  const byId = new Map(products.map((product) => [product.id, product]))
  return Object.entries(cart).reduce((sum, [id, quantity]) => {
    return sum + (byId.get(id)?.selling_price_won ?? 0) * quantity
  }, 0)
}
