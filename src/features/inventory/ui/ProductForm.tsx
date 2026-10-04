'use client'
import { useState } from 'react'
import { ConfirmationDialog } from '@/components/ui/ConfirmationDialog'
import { formatWon } from '@/lib/format/currency'
import { RecordChangeSchema } from '@/features/management/domain'
import { useRecordOperation } from '@/features/management/use-record-operation'
import { OperationFeedback } from '@/features/management/OperationFeedback'
export function ProductForm({userId,onSaved}:{userId:string;onSaved():void}) {
  const [form,setForm]=useState({sku:'',name:'',category:'Snacks',sellingPriceWon:1000,reorderLevel:5})
  const [review,setReview]=useState<typeof form|null>(null),[error,setError]=useState('')
  const operation=useRecordOperation('PRODUCT',userId,onSaved)
  const locked=!operation.ready||operation.busy||operation.blocked||!!operation.pending
  return <section className="panel form-stack"><h2>Add product</h2><p>A product defines what can be sold. Receive stock separately to record quantity and purchase cost.</p>
    <OperationFeedback operation={operation}/>
    <form className="form-grid" onSubmit={e=>{e.preventDefault();if(locked)return;const parsed=RecordChangeSchema.safeParse({...form,kind:"PRODUCT",action:"CREATE_PRODUCT",requestKey:crypto.randomUUID(),reason:"New catalog product reviewed by authorized operator",verified:true});if(!parsed.success){setError('Check the SKU, name, category, price and reorder level.');return}setError('');setReview({...form,sku:form.sku.trim(),name:form.name.trim(),category:form.category.trim()})}}>
      <label className="field"><span>SKU</span><input required maxLength={40} disabled={locked} value={form.sku} onChange={e=>setForm({...form,sku:e.target.value})}/></label>
      <label className="field"><span>Name</span><input required maxLength={120} disabled={locked} value={form.name} onChange={e=>setForm({...form,name:e.target.value})}/></label>
      <label className="field"><span>Category</span><input required maxLength={80} disabled={locked} value={form.category} onChange={e=>setForm({...form,category:e.target.value})}/></label>
      <label className="field"><span>Selling price (₩)</span><input required type="number" min={0} max={10000000} disabled={locked} value={form.sellingPriceWon} onChange={e=>setForm({...form,sellingPriceWon:Number(e.target.value)})}/></label>
      <label className="field"><span>Reorder level</span><input required type="number" min={0} max={1000000} disabled={locked} value={form.reorderLevel} onChange={e=>setForm({...form,reorderLevel:Number(e.target.value)})}/></label>
      <button className="primary-action" disabled={locked}>Review new product</button>{error&&<p className="error-message" role="alert">{error}</p>}
    </form>
    {review&&<ConfirmationDialog title="Create product?" description="Create this product in the shared POS and store catalog with zero stock. Its permanent SKU cannot be reused for another product." confirmLabel="Create product" cancelLabel="Go back" onCancel={()=>setReview(null)} onConfirm={async()=>{
      const created=await operation.execute({...review,kind:'PRODUCT',action:'CREATE_PRODUCT',requestKey:crypto.randomUUID(),reason:'New catalog product reviewed by authorized operator',verified:true})
      setReview(null);if(created)setForm({...form,sku:'',name:''})
    }}><dl className="detail-list"><div><dt>Product</dt><dd>{review.name} · {review.sku}</dd></div><div><dt>Category</dt><dd>{review.category}</dd></div><div><dt>Selling price</dt><dd>{formatWon(review.sellingPriceWon)}</dd></div><div><dt>Reorder at</dt><dd>{review.reorderLevel}</dd></div></dl></ConfirmationDialog>}
  </section>
}
