import type { CartLine, CatalogProduct } from '@/features/pos/domain'

export type CartState = Readonly<Record<string, number>>

export function addProduct(cart: CartState, product: CatalogProduct): CartState {
  if (product.sold_out) return cart
  const next = Math.min((cart[product.id] ?? 0) + 1, product.stock_on_hand)
  return { ...cart, [product.id]: next }
}

export function changeQuantity(cart: CartState, productId: string, delta: number, max: number): CartState {
  const next = Math.max(0, Math.min((cart[productId] ?? 0) + delta, max))
  if (next === 0) {
    const copy = { ...cart }
    delete copy[productId]
    return copy
  }
  return { ...cart, [productId]: next }
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
