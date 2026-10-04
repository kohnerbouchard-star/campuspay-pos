'use client'
import { RecordRemovalProvider,RecordRemovalButton } from '@/features/removal/RecordRemoval'
import { RecordManager } from '@/features/management/RecordManager'
import type { Permission } from '@/features/auth/domain'
import { useEffect, useState } from 'react'
import type { InventoryProduct } from '@/features/inventory/domain'
import type { InventoryLot } from '@/features/inventory/domain'
import { apiFetch } from '@/lib/api/client'
import { fetchLots } from '@/features/inventory/client'
import { ProductForm } from '@/features/inventory/ui/ProductForm'
import { PriceChangeForm } from '@/features/inventory/ui/PriceChangeForm'
import { ReceiptForm } from '@/features/inventory/ui/ReceiptForm'
import { LotTable } from '@/features/inventory/ui/LotTable'
import { StockAdjustmentForm } from '@/features/inventory/ui/StockAdjustmentForm'
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/Feedback'
import { Money } from '@/components/ui/Money'
const views = { products: 'Products', receive: 'Receive stock', lots: 'Inventory lots', create: 'Add product', price: 'Change price', adjust: 'Remove stock', manage: 'Edit / archive products' } as const
export function InventoryScreen({userId,permissions,superAdmin=false,removalEnabled=false}:{userId:string;permissions:readonly Permission[];superAdmin?:boolean;removalEnabled?:boolean}) {
  const [products, setProducts] = useState<InventoryProduct[]>([])
  const [lots, setLots] = useState<InventoryLot[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [loaded, setLoaded] = useState(false)
  const [revision, setRevision] = useState(0)
  const [view, setView] = useState<keyof typeof views>('products')
  const [query, setQuery] = useState('')
  useEffect(() => {
    let active = true
    void Promise.all([apiFetch<InventoryProduct[]>('/api/inventory/products'), fetchLots()]).then(([p, l]) => { if (active) { setProducts(p); setLots(l); setError(null); setLoaded(true) } }).catch((e: unknown) => { if (active) setError(e instanceof Error ? e.message : 'Inventory could not be loaded.') }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [revision])
  const permitted=(key:keyof typeof views)=>permissions.includes(({products:'inventory.read',lots:'inventory.read',receive:'inventory.receive',create:'inventory.product.manage',price:'inventory.price.manage',adjust:'inventory.adjust',manage:'inventory.product.manage'} as const)[key])
  const canManage=permissions.includes('inventory.product.manage')
  const refresh = () => { setLoading(true); setRevision(value => value + 1) }
  const filtered = products.filter(product => `${product.name} ${product.sku} ${product.category}`.toLowerCase().includes(query.toLowerCase()))
  const content=<main className="workspace"><header className="workspace-header"><div><p className="eyebrow">Stock operations</p><h1>Inventory</h1><p>One stock pool for the register and online store.</p></div></header>
    <div className="stat-grid"><div><span>Products</span><strong>{loading ? '—' : products.length}</strong></div><div><span>Out of stock</span><strong>{loading ? '—' : products.filter(row => row.stock_on_hand === 0).length}</strong></div><div><span>Low stock</span><strong>{loading ? '—' : products.filter(row => row.low_stock && row.stock_on_hand > 0).length}</strong></div><div><span>Stock value</span><strong>{loading ? '—' : <Money amount={lots.reduce((sum, lot) => sum + lot.inventory_value_won, 0)} />}</strong></div></div>
    <div className="inventory-task-groups">{([['Browse stock', ['products', 'lots']], ['Manage stock', ['receive', 'create', 'price', 'adjust']]] as const).map(([label, keys]) => <div key={label} className="inventory-task-group"><span>{label}</span><div className="segmented" role="group" aria-label={label}>{keys.filter(key=>permitted(key)).map(key => <button key={key} aria-pressed={view === key} className={view === key ? 'active' : ''} onClick={() => setView(key)}>{views[key]}</button>)}</div></div>)}</div>
    {canManage&&<button type="button" className="secondary-action" aria-pressed={view==='manage'} onClick={()=>setView('manage')}>Edit / archive products</button>}
    {error && <ErrorState message={error} onRetry={refresh} />}{loading && loaded && <p className="notice" role="status">Refreshing inventory…</p>}{loading && !loaded ? <LoadingState label="Loading inventory…" /> : <>
      {view === 'products' && <section className="panel"><div className="panel-heading"><h2>Product register</h2><label className="field"><span>Search products, SKU or category</span><input type="search" className="search-input" value={query} onChange={e => setQuery(e.target.value)} /></label></div>{filtered.length === 0 ? <EmptyState title="No products found">Add a product or try a different search.</EmptyState> : <div className="table-scroll" role="region" tabIndex={0} aria-label="Product register"><table><thead><tr><th>Product</th><th>Category</th><th className="numeric">Stock</th><th className="numeric">Reorder at</th><th className="numeric">Selling price</th><th>Status</th>{superAdmin&&<th>Actions</th>}</tr></thead><tbody>{filtered.map(row => <tr key={row.id}><td><strong>{row.name}</strong><small>{row.sku}</small></td><td>{row.category}</td><td className="numeric">{row.stock_on_hand}</td><td className="numeric">{row.reorder_level}</td><td className="numeric"><Money amount={row.selling_price_won} /></td><td><span className={`status-pill ${row.stock_on_hand === 0 ? 'stock-empty' : row.low_stock ? 'stock-low' : ''}`}>{row.stock_on_hand === 0 ? 'Out of stock' : row.low_stock ? 'Reorder soon' : 'In stock'}</span></td>{superAdmin&&<td><RecordRemovalButton kind="PRODUCT" targetId={row.id}/></td>}</tr>)}</tbody></table></div>}</section>}
      {view === 'manage' && canManage && <RecordManager kind="PRODUCT" userId={userId} onChanged={refresh}/>}
      {view === 'lots' && <LotTable lots={lots} />}{view === 'create' && <ProductForm userId={userId} onSaved={refresh} />}{view === 'price' && <PriceChangeForm userId={userId} products={products} onSaved={refresh} />}{view === 'receive' && <ReceiptForm products={products} onSaved={refresh} />}{view === 'adjust' && <StockAdjustmentForm products={products} lots={lots} onSaved={refresh} />}
    </>}
  </main>
  return superAdmin?<RecordRemovalProvider userId={userId} enabled={removalEnabled} onChanged={refresh}>{content}</RecordRemovalProvider>:content
}
