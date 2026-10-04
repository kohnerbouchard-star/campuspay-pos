'use client'
import { useRef, useState } from 'react'
import type { CatalogProduct } from '@/features/pos/domain'
import { apiFetch } from '@/lib/api/client'
import { ConfirmationDialog } from '@/components/ui/ConfirmationDialog'
import { formatWon } from '@/lib/format/currency'
import { RecordDirectorySchema } from '@/features/management/domain'
import { useRecordOperation } from '@/features/management/use-record-operation'
import { OperationFeedback } from '@/features/management/OperationFeedback'
export function PriceChangeForm({products,userId,onSaved}:{products:CatalogProduct[];userId:string;onSaved():void}) {
 const [productId,setProductId]=useState(''),[price,setPrice]=useState(1000),[reason,setReason]=useState(''),[error,setError]=useState(''),[loading,setLoading]=useState(false)
 const [review,setReview]=useState<{id:string;name:string;oldPrice:number;price:number;version:string;reason:string}|null>(null)
 const reading=useRef(false),operation=useRecordOperation('PRODUCT',userId,onSaved)
 const locked=loading||!operation.ready||operation.busy||operation.blocked||!!operation.pending
 return <section className="panel form-stack"><h2>Update selling price</h2><p>Review the current and new prices before changing both the register and store catalog. Completed sales stay unchanged.</p><OperationFeedback operation={operation}/>
  <form className="form-grid" onSubmit={async e=>{e.preventDefault();if(reading.current||locked)return;reading.current=true;setLoading(true);setError('')
   try{const data=RecordDirectorySchema.parse(await apiFetch<unknown>(`/api/management?kind=PRODUCT&status=ACTIVE&targetId=${encodeURIComponent(productId)}`));const row=data.records[0];if(!row||row.selling_price_won===null)throw new Error('Refresh the product list before changing its price.');if(row.selling_price_won===price)throw new Error('Enter a different price. The current price is unchanged.');setReview({id:row.id,name:row.name,oldPrice:row.selling_price_won,price,version:row.updated_at,reason})}
   catch(error){setError(error instanceof Error?error.message:'Could not read the current product.')}finally{reading.current=false;setLoading(false)}
  }}>
   <label className="field"><span>Product</span><select required disabled={locked} value={productId} onChange={e=>{setProductId(e.target.value);setPrice(products.find(p=>p.id===e.target.value)?.selling_price_won??0)}}><option value="">Select</option>{products.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
   <label className="field"><span>New price (₩)</span><input required type="number" min={0} max={10000000} disabled={locked} value={price} onChange={e=>setPrice(Number(e.target.value))}/></label>
   <label className="field span-two"><span>Reason</span><input required minLength={10} maxLength={500} disabled={locked} value={reason} onChange={e=>setReason(e.target.value)}/></label>
   <button className="primary-action" disabled={locked||!productId}>Review price change</button>{error&&<p className="error-message" role="alert">{error}</p>}
  </form>
  {review&&<ConfirmationDialog title="Change selling price?" description="This changes future purchases in both the POS and online store. Existing receipts retain the price charged at the time." confirmLabel="Record price change" cancelLabel="Go back" onCancel={()=>setReview(null)} onConfirm={async()=>{await operation.execute({kind:'PRODUCT',action:'CHANGE_PRODUCT_PRICE',targetId:review.id,expectedUpdatedAt:review.version,sellingPriceWon:review.price,reason:review.reason,verified:true,requestKey:crypto.randomUUID()});setReview(null)}}>
   <dl className="detail-list"><div><dt>Product</dt><dd>{review.name}</dd></div><div><dt>Current price</dt><dd>{formatWon(review.oldPrice)}</dd></div><div><dt>New price</dt><dd>{formatWon(review.price)}</dd></div><div><dt>Reason</dt><dd>{review.reason}</dd></div></dl>
  </ConfirmationDialog>}
 </section>
}
