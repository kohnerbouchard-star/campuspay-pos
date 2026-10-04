'use client'
import { createContext,useContext,useEffect,useRef,useState,type ReactNode } from 'react'
import { ConfirmationDialog } from '@/components/ui/ConfirmationDialog'
import { apiFetch } from '@/lib/api/client'
import { RemovalChangeSchema,RemovalDirectorySchema,removalLabels,type RemovalKind,type RemovalResult,type RemovalSnapshot } from './domain'
import { useRemovalOperation } from './use-removal-operation'
type Context={open(kind:RemovalKind,targetId:string):Promise<void>;locked:boolean;revision:number}
const RemovalContext=createContext<Context|null>(null)
export function RecordRemovalProvider({userId,enabled=true,onChanged,children}:{userId:string;enabled?:boolean;onChanged?(result:RemovalResult):void|Promise<void>;children:ReactNode}){
 const [selected,setSelected]=useState<RemovalSnapshot|null>(null),[pin,setPin]=useState(''),[reason,setReason]=useState(''),[error,setError]=useState(''),[loading,setLoading]=useState(false),[revision,setRevision]=useState(0)
 const deadline=useRef(0),flight=useRef(false)
 const operation=useRemovalOperation(userId,async result=>{setRevision(n=>n+1);setSelected(null);setPin('');await onChanged?.(result)})
 const locked=!enabled||!operation.ready||operation.busy||operation.blocked||!!operation.pending||loading
 useEffect(()=>{
  if(!selected||operation.busy)return
  const expire=()=>{setSelected(null);setPin('');setError('Delete/restore review expired. Review the current record again.')}
  const timer=setTimeout(expire,Math.max(0,deadline.current-Date.now())),hide=()=>{if(document.visibilityState!=='visible')expire()}
  document.addEventListener('visibilitychange',hide)
  return()=>{clearTimeout(timer);document.removeEventListener('visibilitychange',hide)}
 },[selected,operation.busy])
 async function open(kind:RemovalKind,targetId:string){
  if(locked||flight.current)return;flight.current=true;setLoading(true);setError('');setPin('');setReason('')
  try{const data=RemovalDirectorySchema.parse(await apiFetch<unknown>(`/api/removals?kind=${kind}&targetId=${targetId}`));if(!data.enabled)throw new Error('Record deletion and restoration are disabled for this installation.');if(!data.records[0])throw new Error('Record not found');deadline.current=Date.now()+60000;setSelected(data.records[0])}
  catch(e){setError(e instanceof Error?e.message:'The current record could not load.')}
  finally{flight.current=false;setLoading(false)}
 }
 async function confirm(){
  if(!selected)return
  if(Date.now()>=deadline.current||document.visibilityState!=='visible'){setSelected(null);setPin('');setError('Review expired. Review this record again.');return}
  const input=RemovalChangeSchema.safeParse({kind:selected.kind,action:selected.deleted?'RESTORE':'DELETE',targetId:selected.target_id,expectedVersion:selected.version,requestKey:crypto.randomUUID(),adminPin:pin,reason,verified:true})
  if(!input.success){setError('Enter a current PIN and a 10–500 character reason.');return}
  setPin('');await operation.execute(input.data);setSelected(null)
 }
 const label=selected?`${selected.deleted?'Restore':'Delete'} ${removalLabels[selected.kind]}`:''
 const description=selected?.deleted?`Restore this record to its directory ${selected.restore_active?'and make it active again':'in its previous inactive state'}. Old sessions remain signed out. This keeps the same identity and credentials.`:'Remove this record from normal directories and stop new use. Linked transactions, credentials and audit history remain. A Super Admin can restore it from Deleted records.'
 return <RemovalContext.Provider value={{open,locked,revision}}>
  <section aria-label="Record deletion status">
   {operation.message&&<p className="success-message" role="status">{operation.message}</p>}
   {(error||operation.error)&&<p className="error-message" role="alert">{error||operation.error}</p>}
   {loading&&<p role="status">Loading the current deletion review…</p>}
   {operation.pending&&<section className="uncertain-result" aria-label="Saved deletion action"><h2>Confirm the previous deletion or restoration</h2><p>Use the same staff account and register. Recovery reads the result or closes an unposted request; it does not repeat it.</p><p>Reference: {operation.pending.requestKey}</p><button className="secondary-action" disabled={operation.busy||operation.blocked} onClick={()=>void operation.recover()}>Recover deletion result</button></section>}
  </section>
  {children}
  {selected&&<ConfirmationDialog key={`${selected.target_id}:${selected.version}`} title={`${label}?`} description={description} confirmLabel={label} cancelLabel="Keep record" destructive={!selected.deleted} confirmationText={selected.code}
   confirmDisabled={locked||!!selected.blocker||!/^\d{4,16}$/.test(pin)||reason.trim().length<10||reason.trim().length>500} onCancel={()=>{setSelected(null);setPin('')}} onConfirm={confirm}>
   <dl className="detail-list"><div><dt>Record</dt><dd>{selected.name} · {selected.code}</dd></div></dl>
   {selected.blocker&&<p role="alert" className="notice">{selected.blocker}</p>}
   <label className="field"><span>Reason for deletion or restoration</span><textarea required minLength={10} maxLength={500} value={reason} disabled={operation.busy} onChange={e=>setReason(e.target.value)}/></label>
   <label className="field"><span>Current Super Admin PIN</span><input type="password" inputMode="numeric" autoComplete="off" value={pin} disabled={operation.busy} onChange={e=>setPin(e.target.value.replace(/\D/g,'').slice(0,16))}/></label>
   <p className="muted">This review expires after one minute or leaving the tab. The PIN is never saved in browser recovery storage.</p>
  </ConfirmationDialog>}
 </RemovalContext.Provider>
}
export function useRemovalRevision(){return useContext(RemovalContext)?.revision??0}
export function RecordRemovalButton({kind,targetId,disabled=false,restore=false}:{kind:RemovalKind;targetId:string;disabled?:boolean;restore?:boolean}){
 const context=useContext(RemovalContext)
 if(!context)return null
 return <button type="button" className={`table-action ${restore?'':'danger-action'}`} disabled={disabled||context.locked} onClick={()=>void context.open(kind,targetId)}>{restore?'Restore':'Delete'} {removalLabels[kind]}</button>
}
export function DeletedRecords(){
 const context=useContext(RemovalContext),[kind,setKind]=useState('ALL'),[offset,setOffset]=useState(0),[data,setData]=useState<ReturnType<typeof RemovalDirectorySchema.parse>|null>(null),[error,setError]=useState(''),[refresh,setRefresh]=useState(0)
 const revision=context?.revision??0
 useEffect(()=>{let active=true;void apiFetch<unknown>(`/api/removals?kind=${kind}&offset=${offset}`).then(raw=>{if(active){setData(RemovalDirectorySchema.parse(raw));setError('')}}).catch(()=>{if(active){setData(null);setError('Deleted records could not load. Refresh this directory.')}});return()=>{active=false}},[kind,offset,revision,refresh])
 return <section className="panel form-stack" aria-label="Deleted records"><h2>Deleted records</h2><p>Restore products, students, staff, registers and coupons with their original identity. Transaction history is retained. Restoring an account does not revive its old sessions.</p>
  <div className="action-row"><label className="field"><span>Deleted record type</span><select value={kind} onChange={e=>{setKind(e.target.value);setOffset(0)}}><option value="ALL">All record types</option>{Object.entries(removalLabels).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select></label><button type="button" className="secondary-action" onClick={()=>setRefresh(n=>n+1)}>Refresh deleted records</button></div>
  {error&&<p className="error-message" role="alert">{error}</p>}
  {data&&<><div className="table-scroll"><table><thead><tr><th>Record</th><th>Type</th><th>Restores as</th><th>Action</th></tr></thead><tbody>{data.records.map(row=><tr key={`${row.kind}:${row.target_id}`}><td><strong>{row.name}</strong><small>{row.code}</small></td><td>{removalLabels[row.kind]}</td><td>{row.restore_active?'Active':'Inactive'}</td><td><RecordRemovalButton kind={row.kind} targetId={row.target_id} restore/></td></tr>)}{!data.records.length&&<tr><td colSpan={4}>No deleted records.</td></tr>}</tbody></table></div><div className="action-row"><button disabled={offset===0||context?.locked} onClick={()=>setOffset(n=>Math.max(0,n-50))}>Previous deleted records</button><span>{data.total} deleted records · Page {offset/50+1}</span><button disabled={offset+50>=data.total||context?.locked} onClick={()=>setOffset(n=>n+50)}>Next deleted records</button></div></>}
 </section>
}
