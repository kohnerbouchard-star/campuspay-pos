'use client'
import { useMemo, useState } from 'react'
import type { CatalogProduct } from '@/features/pos/domain'
import { formatWon } from '@/lib/format/currency'
import { EmptyState } from '@/components/ui/Feedback'
import { Icon } from '@/components/ui/Icon'
import { ProductCategoryIcon, categoryTone } from '@/components/ui/ProductCategoryIcon'
export function ProductGrid({ products, onSelect,canSelect=true }: { products: CatalogProduct[];canSelect?:boolean; onSelect(p: CatalogProduct): void }) {
  const [search, setSearch] = useState('')
  const Card=canSelect?'button':'div'
  const [category, setCategory] = useState('All')
  const categories = useMemo(() => ['All', ...Array.from(new Set(products.map(product => product.category))).sort()], [products])
  const filtered = products.filter(product => (category === 'All' || product.category === category) && `${product.name} ${product.sku}`.toLowerCase().includes(search.trim().toLowerCase()))
  return <section className="product-browser" aria-label="Products">
    <label className="field"><span>Find a product</span><span className="input-with-icon"><Icon name="search" /><input type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Search name or SKU" /></span></label>
    <div className="category-tabs" aria-label="Product categories">{categories.map(item => <button key={item} aria-pressed={category === item} onClick={() => setCategory(item)}>{item === 'All' ? <Icon name="grid" size={17} /> : <ProductCategoryIcon category={item} size={17} />}{item}</button>)}</div>
    {!filtered.length && <EmptyState title="No products found">Try another search or category.</EmptyState>}
    <div className="product-grid">{filtered.map(product => <Card className="product-card" data-tone={categoryTone(product.category)} key={product.id} disabled={canSelect?product.sold_out:undefined} onClick={canSelect?()=>onSelect(product):undefined}>
      <span className="product-card-top"><span className="product-medallion"><ProductCategoryIcon category={product.category} size={25} /></span><span className="product-category">{product.category}</span></span>
      <strong>{product.name}</strong>
      <span className="product-card-bottom"><span className="product-price">{formatWon(product.selling_price_won)}</span>{canSelect&&<span className="product-add" aria-hidden="true"><Icon name="plus" size={17} /></span>}</span>
      <small>{product.sold_out ? 'Sold out' : `${product.stock_on_hand} available`}</small>
    </Card>)}</div>
  </section>
}
