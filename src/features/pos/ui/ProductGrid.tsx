'use client'

import type { CatalogProduct } from '@/features/pos/domain'
import { formatWon } from '@/lib/format/currency'

export function ProductGrid({ products, onSelect }: { products: CatalogProduct[]; onSelect(p: CatalogProduct): void }) {
  return <section className="product-grid" aria-label="Products">
    {products.map((product) => (
      <button
        className="product-card"
        key={product.id}
        disabled={product.sold_out}
        onClick={() => onSelect(product)}
      >
        <span className="product-category">{product.category}</span>
        <strong>{product.name}</strong>
        <span>{formatWon(product.selling_price_won)}</span>
        <small>{product.sold_out ? 'SOLD OUT' : `${product.stock_on_hand} available`}</small>
      </button>
    ))}
  </section>
}
