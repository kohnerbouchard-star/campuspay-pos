'use client'

import { useMemo, useState } from 'react'
import type { CatalogProduct } from '@/features/pos/domain'
import { postReceipt } from '@/features/inventory/client'
import { calculateLandedCosts } from '@/features/inventory/costing'
import { formatWon } from '@/lib/format/currency'

export function ReceiptForm({products,onSaved}:{products:CatalogProduct[];onSaved():void}){
 const today=new Date().toISOString().slice(0,10)
 const [form,setForm]=useState({supplierName:'',supplierInvoice:'',purchaseDate:today,shippingWon:0,otherCostsWon:0,discountWon:0,notes:'',productId:'',quantity:1,purchaseUnitCostWon:0,expirationDate:''})
 const [message,setMessage]=useState<string|null>(null)
 const preview=useMemo(()=>{try{return calculateLandedCosts([{id:'line',quantity:form.quantity,purchaseUnitCostWon:form.purchaseUnitCostWon}],form.shippingWon,form.otherCostsWon,form.discountWon)[0]}catch{return null}},[form])
 async function submit(e:React.FormEvent){e.preventDefault();setMessage(null);try{const result=await postReceipt({supplierName:form.supplierName,supplierInvoice:form.supplierInvoice,purchaseDate:form.purchaseDate,shippingWon:form.shippingWon,otherCostsWon:form.otherCostsWon,discountWon:form.discountWon,notes:form.notes,lines:[{productId:form.productId,quantity:form.quantity,purchaseUnitCostWon:form.purchaseUnitCostWon,expirationDate:form.expirationDate||null}]});setMessage(`Receipt posted: ${String((result as {receipt_number?:string}).receipt_number??'complete')}`);onSaved()}catch(err){setMessage(err instanceof Error?err.message:'Could not post receipt')}}
 const set=(key:string,value:string|number)=>setForm(current=>({...current,[key]:value}))
 return <form className="panel form-grid" onSubmit={submit}>
  <div className="panel-heading span-two"><div><p className="eyebrow">Only positive-stock path</p><h2>Receive purchased stock</h2></div><span className="status-pill">Costed receipt</span></div>
  <label className="field"><span>Supplier</span><input required value={form.supplierName} onChange={e=>set('supplierName',e.target.value)}/></label>
  <label className="field"><span>Supplier invoice</span><input required value={form.supplierInvoice} onChange={e=>set('supplierInvoice',e.target.value)}/></label>
  <label className="field"><span>Purchase date</span><input type="date" required value={form.purchaseDate} onChange={e=>set('purchaseDate',e.target.value)}/></label>
  <label className="field"><span>Product</span><select required value={form.productId} onChange={e=>set('productId',e.target.value)}><option value="">Select</option>{products.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
  <label className="field"><span>Quantity</span><input type="number" min="1" required value={form.quantity} onChange={e=>set('quantity',Number(e.target.value))}/></label>
  <label className="field"><span>Purchase cost per unit (₩)</span><input type="number" min="0" required value={form.purchaseUnitCostWon} onChange={e=>set('purchaseUnitCostWon',Number(e.target.value))}/></label>
  <label className="field"><span>Shipping (₩)</span><input type="number" min="0" value={form.shippingWon} onChange={e=>set('shippingWon',Number(e.target.value))}/></label>
  <label className="field"><span>Other costs (₩)</span><input type="number" min="0" value={form.otherCostsWon} onChange={e=>set('otherCostsWon',Number(e.target.value))}/></label>
  <label className="field"><span>Discount (₩)</span><input type="number" min="0" value={form.discountWon} onChange={e=>set('discountWon',Number(e.target.value))}/></label>
  <label className="field"><span>Expiration date</span><input type="date" value={form.expirationDate} onChange={e=>set('expirationDate',e.target.value)}/></label>
  <label className="field span-two"><span>Notes</span><input value={form.notes} onChange={e=>set('notes',e.target.value)}/></label>
  {preview&&<div className="cost-preview span-two"><span>Base {formatWon(preview.baseCostWon)}</span><span>Landed total {formatWon(preview.totalLandedCostWon)}</span><strong>Estimated unit cost {formatWon(preview.landedUnitCostWon)}</strong></div>}
  <button className="primary-action" disabled={!form.productId}>Post stock receipt</button>{message&&<p className="form-message">{message}</p>}
 </form>
}
