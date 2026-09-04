'use client'

import { useState } from 'react'
import { addProduct } from '@/features/inventory/client'

export function ProductForm({ onSaved }: { onSaved(): void }) {
  const [form, setForm] = useState({ sku:'', name:'', category:'Snacks', sellingPriceWon:1000, reorderLevel:5 })
  const [message,setMessage]=useState<string|null>(null)
  async function submit(e:React.FormEvent){e.preventDefault();setMessage(null);try{await addProduct(form);setMessage('Product created.');setForm({...form,sku:'',name:''});onSaved()}catch(err){setMessage(err instanceof Error?err.message:'Could not create product')}}
  return <form className="panel form-grid" onSubmit={submit}>
    <div className="panel-heading"><div><p className="eyebrow">Catalog</p><h2>Add product</h2></div></div>
    <label className="field"><span>SKU</span><input required value={form.sku} onChange={e=>setForm({...form,sku:e.target.value})}/></label>
    <label className="field"><span>Name</span><input required value={form.name} onChange={e=>setForm({...form,name:e.target.value})}/></label>
    <label className="field"><span>Category</span><input required value={form.category} onChange={e=>setForm({...form,category:e.target.value})}/></label>
    <label className="field"><span>Selling price (₩)</span><input type="number" min="0" required value={form.sellingPriceWon} onChange={e=>setForm({...form,sellingPriceWon:Number(e.target.value)})}/></label>
    <label className="field"><span>Reorder level</span><input type="number" min="0" required value={form.reorderLevel} onChange={e=>setForm({...form,reorderLevel:Number(e.target.value)})}/></label>
    <button className="primary-action">Create product</button>{message&&<p className="form-message">{message}</p>}
  </form>
}
