'use client'
import { ProductPhotoEditor } from '@/features/product-photos/ProductPhotoEditor'
import { useEffect, useRef, useState } from 'react'
import type { LeaveState } from '@/components/ui/leave-state'
import { apiFetch } from '@/lib/api/client'
import { formatWon } from '@/lib/format/currency'
import { ConfirmationDialog } from '@/components/ui/ConfirmationDialog'
import { RecordDirectorySchema, RecordChangeSchema, type RecordDirectory, type RecordKind, type ManagedRecord } from './domain'
import { useRecordOperation } from './use-record-operation'
import { OperationFeedback } from './OperationFeedback'

export function RecordManager({kind,userId,targetId,onChanged,onLeaveStateChange,onPhotoPendingChange}:{kind:RecordKind;userId:string;targetId?:string;onChanged?():void|Promise<void>;onLeaveStateChange?(state:LeaveState):void;onPhotoPendingChange?(pending:boolean):void}) {
  const editorHeading=useRef<HTMLHeadingElement>(null)
  const reviewDeadline=useRef(0)
  const [data,setData]=useState<RecordDirectory|null>(null),[error,setError]=useState(''),[loading,setLoading]=useState(true)
  const [query,setQuery]=useState(''),[status,setStatus]=useState('ALL'),[offset,setOffset]=useState(0),[revision,setRevision]=useState(0)
  const [selected,setSelected]=useState<ManagedRecord|null>(null),[editing,setEditing]=useState(false),[confirm,setConfirm]=useState(false)
  const [photoPending,setPhotoPending]=useState(false)
  useEffect(()=>{onPhotoPendingChange?.(photoPending);return()=>onPhotoPendingChange?.(false)},[photoPending,onPhotoPendingChange])
  const [name,setName]=useState(''),[category,setCategory]=useState(''),[reorder,setReorder]=useState(0),[reason,setReason]=useState(''),[pin,setPin]=useState('')
  const refresh=async()=>{setSelected(null);setConfirm(false);setPin('');setLoading(true);setRevision(n=>n+1);await onChanged?.()}
  const operation=useRecordOperation(kind,userId,refresh)
  useEffect(()=>{
    if(kind!=='STUDENT'||!confirm||operation.busy)return
    const expire=()=>{setPin('');setConfirm(false);setError('Student status review expired. Review the record again and enter your current PIN.')}
    const timer=setTimeout(expire,Math.max(0,reviewDeadline.current-Date.now()))
    const hide=()=>{if(document.visibilityState!=='visible')expire()}
    document.addEventListener('visibilitychange',hide)
    return()=>{clearTimeout(timer);document.removeEventListener('visibilitychange',hide)}
  },[kind,confirm,operation.busy])
  useEffect(()=>{
    let active=true
    const timer=setTimeout(()=>{setLoading(true);setError('')
      const q=new URLSearchParams({kind,query,status,offset:String(offset)});if(targetId)q.set('targetId',targetId)
      apiFetch<unknown>(`/api/management?${q}`).then(raw=>{const result=RecordDirectorySchema.parse(raw);if(active)setData(result)})
        .catch(e=>{if(active){setData(null);setError(e instanceof Error?e.message:'Records could not load.')}})
        .finally(()=>{if(active)setLoading(false)})
    },150)
    return()=>{active=false;clearTimeout(timer)}
  },[kind,query,status,offset,targetId,revision])
  const locked=photoPending||loading||!operation.ready||operation.busy||operation.blocked||!!operation.pending
  useEffect(()=>{onLeaveStateChange?.(photoPending||!operation.ready||operation.busy||operation.blocked||operation.pending?'pending':selected||confirm?'dirty':'clean')},[photoPending,operation.ready,operation.busy,operation.blocked,operation.pending,selected,confirm,onLeaveStateChange])
  function select(row:ManagedRecord,edit=false){setSelected(structuredClone(row));setEditing(edit);setName(row.name);setCategory(row.category??'');setReorder(row.reorder_level??0);setReason('');setPin('');setError('')}
  useEffect(()=>{if(selected&&!confirm){editorHeading.current?.focus();editorHeading.current?.scrollIntoView({block:'start'})}},[selected,confirm])
  const action=editing?'UPDATE_PRODUCT':kind==='PRODUCT'?(selected?.active?'ARCHIVE_PRODUCT':'RESTORE_PRODUCT'):(selected?.active?'DEACTIVATE_STUDENT':'REACTIVATE_STUDENT')
  const label=editing?'Save product details':kind==='PRODUCT'?(selected?.active?'Archive product':'Restore product'):(selected?.active?'Deactivate student':'Reactivate student')
  async function apply(){
    if(!selected)return
    if(kind==='STUDENT'&&(Date.now()>=reviewDeadline.current||document.visibilityState!=='visible')){
      setPin('');setConfirm(false);setError('Student status review expired. Review the record again.');return
    }
    const input=RecordChangeSchema.safeParse({kind,action,targetId:selected.id,expectedUpdatedAt:selected.updated_at,
      requestKey:crypto.randomUUID(),reason,verified:true,...(editing?{name,category,reorderLevel:reorder}:{}),...(kind==='STUDENT'?{adminPin:pin}:{})})
    if(!input.success){setError('Check the fields, the 10–500 character reason, and administrator PIN.');setConfirm(false);return}
    // PIN lives only in the current request; no storage, logs or summary copies.
    setPin('');await operation.execute(input.data);setConfirm(false);setSelected(null)
  }
  const explanation=editing?'Changes apply to the shared catalog. Existing receipt and order snapshots are unchanged. Price changes use their separate audited workflow.'
    :kind==='PRODUCT'?(selected?.active?'This product will leave the POS and store catalog. Stock, receipts and sales history are not deleted; the SKU remains reserved. You can restore the same product later.':'This product will return to the shared catalog. No stock is added and no history is rewritten.')
    :selected?.active?'This student will no longer be able to spend or sign in to the store. Existing sessions end. The student ID, card assignment, PIN record and transaction history remain; no balance is erased.'
    :'This student becomes active again. Existing valid credentials can be used, but old sessions remain signed out. This does not issue a missing card or PIN.'
  return <section className="panel form-stack" aria-label={kind==='PRODUCT'?'Product lifecycle management':'Student account lifecycle'}>
    <h2>{kind==='PRODUCT'?'Edit, archive or restore products':'Student account status'}</h2>
    <p className="muted">{kind==='PRODUCT'?'Archive replaces permanent deletion so recorded purchases and sales remain traceable. Use Remove stock to record physical loss or a supplier return.':'Deactivation replaces permanent deletion. Settle any wallet balance and finish open orders first. Staff accounts are managed separately in Staff & registers.'}</p>
    <OperationFeedback operation={operation}/>
    {!targetId&&<div className="form-grid"><label className="field"><span>Find a product to manage</span><input type="search" maxLength={120} value={query} disabled={!!selected||operation.busy} onChange={e=>{setQuery(e.target.value);setOffset(0)}}/></label>
      <label className="field"><span>Product availability</span><select value={status} disabled={!!selected||operation.busy} onChange={e=>{setStatus(e.target.value);setOffset(0)}}><option value="ALL">Active and archived</option><option value="ACTIVE">Active only</option><option value="INACTIVE">Archived only</option></select></label></div>}
    {error&&<p className="error-message" role="alert">{error}</p>}
    <button className="secondary-action" type="button" disabled={operation.busy||photoPending} onClick={()=>{setSelected(null);setRevision(n=>n+1)}}>Refresh managed records</button>
    {loading?<p role="status">Loading current record status…</p>:data&&<>
      <div className="table-scroll" role="region" tabIndex={0} aria-label="Managed records"><table><thead><tr><th>Record</th><th>Status</th><th>{kind==='PRODUCT'?'Remaining stock':'Wallet balance'}</th><th>Actions</th></tr></thead><tbody>
      {data.records.map(row=><tr key={row.id}><td><strong>{row.name}</strong><small>{row.code}</small></td><td>{row.active?'Active':kind==='PRODUCT'?'Archived':'Inactive'}</td><td>{kind==='PRODUCT'?row.quantity_or_balance:row.quantity_or_balance===null?'Not assigned':formatWon(row.quantity_or_balance)}</td><td>
        {kind==='PRODUCT'&&row.active&&<button className="table-action" disabled={locked} onClick={()=>select(row,true)}>Edit product</button>}
        <button className="table-action" disabled={locked||!!row.blocker} onClick={()=>select(row)}>{kind==='PRODUCT'?(row.active?'Archive product':'Restore product'):(row.active?'Deactivate student':'Reactivate student')}</button>
        {row.blocker&&<small>{row.blocker}</small>}</td></tr>)}
      {!data.records.length&&<tr><td colSpan={4}>No matching records. Change the filter or return to the previous page.</td></tr>}
      </tbody></table></div>
      {!targetId&&<div className="action-row"><button disabled={locked||offset===0} onClick={()=>setOffset(n=>Math.max(0,n-50))}>Previous managed records</button><span>{data.total} records · Page {offset/50+1}</span><button disabled={locked||offset+50>=data.total} onClick={()=>setOffset(n=>n+50)}>Next managed records</button></div>}
    </>}
    {selected&&!confirm&&<form className="form-stack management-editor" onSubmit={e=>{e.preventDefault();if(!locked){setError('');setPin('');reviewDeadline.current=Date.now()+60000;setConfirm(true)}}}>
      <h3 tabIndex={-1} ref={editorHeading}>{label}: {selected.name} ({selected.code})</h3><p>{explanation}</p>
      {editing&&<><label className="field"><span>Product name</span><input required maxLength={120} value={name} onChange={e=>setName(e.target.value)}/></label><label className="field"><span>Product category</span><input required maxLength={80} value={category} onChange={e=>setCategory(e.target.value)}/></label><label className="field"><span>Product reorder level</span><input type="number" min={0} max={1000000} required value={reorder} onChange={e=>setReorder(Number(e.target.value))}/></label></>}
      {kind==='PRODUCT'&&editing&&<ProductPhotoEditor key={selected.id} productId={selected.id} name={selected.name} category={selected.category??''} userId={userId} onChanged={onChanged} onPendingChange={setPhotoPending}/>}
      <label className="field"><span>Reason for record change</span><textarea required minLength={10} maxLength={500} value={reason} onChange={e=>setReason(e.target.value)}/></label>
      <div className="action-row"><button type="button" className="secondary-action" disabled={photoPending} onClick={()=>{setSelected(null);setPin('')}}>Cancel record change</button><button className="primary-action" disabled={locked}>Review record change</button></div>
    </form>}
    {selected&&confirm&&<ConfirmationDialog title={`${label}?`} description={explanation} confirmLabel={label} cancelLabel="Go back"
      destructive={!editing&&selected.active} confirmationText={!editing?selected.code:undefined} confirmDisabled={locked||(kind==='STUDENT'&&!/^[0-9]{4,16}$/.test(pin))} onCancel={()=>{setConfirm(false);setPin('')}} onConfirm={apply}>
      <dl className="detail-list"><div><dt>Record</dt><dd>{selected.name} · {selected.code}</dd></div>{editing&&<><div><dt>New name</dt><dd>{name}</dd></div><div><dt>Category</dt><dd>{category}</dd></div><div><dt>Reorder at</dt><dd>{reorder}</dd></div></>}<div><dt>Reason</dt><dd>{reason}</dd></div></dl>
      {kind==='STUDENT'&&<><p className="muted">Enter your PIN to approve this change. This review expires after one minute or when you leave this tab.</p><label className="field"><span>Your current PIN</span><input required type="password" autoComplete="off" inputMode="numeric" pattern="[0-9]{4,16}" value={pin} disabled={operation.busy} onChange={e=>setPin(e.target.value.replace(/\D/g,'').slice(0,16))}/></label></>}
    </ConfirmationDialog>}
  </section>
}
