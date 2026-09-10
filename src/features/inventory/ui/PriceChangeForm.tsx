'use client'

import { useRef, useState } from 'react'
import type { CatalogProduct } from '@/features/pos/domain'
import { apiFetch } from '@/lib/api/client'

export function PriceChangeForm({ products, onSaved }:{products:CatalogProduct[];onSaved():void}){
 const pending=useRef(false); const [busy,setBusy]=useState(false)
 const [productId,setProductId]=useState('');const [newPriceWon,setNewPriceWon]=useState(1000);const [reason,setReason]=useState('Scheduled price update');const [message,setMessage]=useState<string|null>(null)
 async function submit(e:React.FormEvent){e.preventDefault();if(pending.current)return;pending.current=true;setBusy(true);try{await apiFetch(`/api/inventory/products/${productId}/price`,{method:'POST',body:JSON.stringify({newPriceWon,reason})});setMessage('Price changed and logged.');onSaved()}catch(err){setMessage(err instanceof Error?err.message:'Could not change price')}finally{pending.current=false;setBusy(false)}}
 return <form className="panel form-grid" onSubmit={submit}><div className="panel-heading"><div><p className="eyebrow">Controlled change</p><h2>Update selling price</h2></div></div>
  <label className="field"><span>Product</span><select required value={productId} onChange={e=>setProductId(e.target.value)}><option value="">Select</option>{products.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
  <label className="field"><span>New price (₩)</span><input type="number" min="0" value={newPriceWon} onChange={e=>setNewPriceWon(Number(e.target.value))}/></label>
  <label className="field span-two"><span>Reason</span><input required minLength={3} value={reason} onChange={e=>setReason(e.target.value)}/></label>
  <button className="primary-action" disabled={busy || !productId}>{busy ? 'Recording…' : 'Record price change'}</button>{message&&<p className="form-message" role="status">{message}</p>}
 </form>
}
