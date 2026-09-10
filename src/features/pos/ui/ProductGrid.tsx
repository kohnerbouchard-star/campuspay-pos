'use client'
import { useMemo, useState } from 'react'
import type { CatalogProduct } from '@/features/pos/domain'
import { formatWon } from '@/lib/format/currency'
import { EmptyState } from '@/components/ui/Feedback'
export function ProductGrid({ products, onSelect }: { products: CatalogProduct[]; onSelect(p: CatalogProduct): void }) {
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState('All')
  const categories = useMemo(() => ['All', ...Array.from(new Set(products.map(product => product.category))).sort()], [products])
  const filtered = products.filter(product => (category === 'All' || product.category === category) && `${product.name} ${product.sku}`.toLowerCase().includes(search.trim().toLowerCase()))
  return <section className="product-browser" aria-label="Products">
    <label className="field"><span>Find a product</span><input type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Search name or SKU" /></label>
    <div className="category-tabs" aria-label="Product categories">{categories.map(item => <button key={item} aria-pressed={category === item} onClick={() => setCategory(item)}>{item}</button>)}</div>
    {!filtered.length && <EmptyState title="No products found">Try another search or category.</EmptyState>}
    <div className="product-grid">{filtered.map(product => <button className="product-card" key={product.id} disabled={product.sold_out} onClick={() => onSelect(product)}>
      <span className="product-category">{product.category}</span><strong>{product.name}</strong><span className="product-price">{formatWon(product.selling_price_won)}</span><small>{product.sold_out ? 'Sold out' : `${product.stock_on_hand} available`}</small>
    </button>)}</div>
  </section>
}
