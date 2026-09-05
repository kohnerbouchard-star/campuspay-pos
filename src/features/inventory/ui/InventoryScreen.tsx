'use client'

import { useEffect, useState } from 'react'
import type { CatalogProduct } from '@/features/pos/domain'
import type { InventoryLot } from '@/features/inventory/domain'
import { apiFetch } from '@/lib/api/client'
import { fetchLots } from '@/features/inventory/client'
import { ProductForm } from '@/features/inventory/ui/ProductForm'
import { PriceChangeForm } from '@/features/inventory/ui/PriceChangeForm'
import { ReceiptForm } from '@/features/inventory/ui/ReceiptForm'
import { LotTable } from '@/features/inventory/ui/LotTable'

export function InventoryScreen() {
  const [products, setProducts] = useState<CatalogProduct[]>([])
  const [lots, setLots] = useState<InventoryLot[]>([])
  const [error, setError] = useState<string | null>(null)

  async function load() {
    try {
      const [p, l] = await Promise.all([apiFetch<CatalogProduct[]>('/api/inventory/products'), fetchLots()])
      setProducts(p); setLots(l); setError(null)
    } catch (e) { setError(e instanceof Error ? e.message : 'Inventory could not be loaded') }
  }

  useEffect(() => {
    let active = true
    void Promise.all([apiFetch<CatalogProduct[]>('/api/inventory/products'), fetchLots()]).then(([p, l]) => {
      if (active) { setProducts(p); setLots(l); setError(null) }
    }).catch((e: unknown) => {
      if (active) setError(e instanceof Error ? e.message : 'Inventory could not be loaded')
    })
    return () => { active = false }
  }, [])

  return <main className="workspace">
    <header className="workspace-header">
      <div><p className="eyebrow">Inventory administration</p><h1>Products, cost and stock</h1></div>
      <span className="status-pill">FIFO default</span>
    </header>
    {error && <p className="error-message">{error}</p>}
    <div className="dashboard-grid">
      <ProductForm onSaved={() => void load()} />
      <PriceChangeForm products={products} onSaved={() => void load()} />
      <ReceiptForm products={products} onSaved={() => void load()} />
      <LotTable lots={lots} />
    </div>
  </main>
}
