 'use client'
import { useEffect, useRef, useState } from 'react'
import { apiFetch } from '@/lib/api/client'
import { formatWon } from '@/lib/format/currency'
import { CashRecoverySchema, CashResultSchema, CashShiftSchema, CashSnapshotSchema, type CashRecovery, type CashSnapshot } from '../domain'
import { CashCountForm } from './CashCountForm'
import { CashHistory } from './CashHistory'
const storageKey='campuspay:cash-operation:v1'
export function CashScreen({enabled,role,userId}:{enabled:boolean;role:string;userId:string}) {
 const [data,setData]=useState<CashSnapshot|null>(null),[pending,setPending]=useState<CashRecovery|null>(null),[ready,setReady]=useState(false)
 const [busy,setBusy]=useState(false),[message,setMessage]=useState(''),[error,setError]=useState(''),[offset,setOffset]=useState(0),[refresh,setRefresh]=useState(0)
 const flight=useRef(false),writer=role!=='accountant'
 useEffect(()=>{let current=true;const timer=setTimeout(()=>{
  try {const raw=sessionStorage.getItem(storageKey);setPending(raw===null?null:CashRecoverySchema.parse(JSON.parse(raw)));setReady(true)} catch {setError('Cash recovery storage is invalid or unavailable. Do not submit another count.')}
  void apiFetch<unknown>(`/api/cash?offset=${offset}`).then(v=>{if(current){setData(CashSnapshotSchema.parse(v));setError('')}}).catch(()=>{if(current)setError('Cash controls could not be loaded. Verify the migration and connection.')})
 },0);return()=>{current=false;clearTimeout(timer)}},[offset,refresh])
 function resolved(){sessionStorage.removeItem(storageKey);setPending(null);setRefresh(n=>n+1)}
 async function submit(counts:Record<string,number>,notes:string){
  if(flight.current || pending || !ready || !data || !writer)return
  const recovery:CashRecovery={requestKey:crypto.randomUUID(),operation:data.current_shift?'CLOSE':'OPEN',shiftId:data.current_shift?.shift_id??null}
  try {const raw=JSON.stringify(recovery);sessionStorage.setItem(storageKey,raw);if(sessionStorage.getItem(storageKey)!==raw)throw new Error('storage')} catch {setError('Recovery reference could not be saved. Nothing was submitted.');return}
  flight.current=true;setBusy(true);setPending(recovery);setError('');setMessage('')
  try {const body=recovery.operation==='CLOSE'?{requestKey:recovery.requestKey,shiftId:recovery.shiftId,counts,notes,verified:true}:{requestKey:recovery.requestKey,counts,verified:true}
   const result=CashShiftSchema.parse(await apiFetch<unknown>(`/api/cash/${recovery.operation.toLowerCase()}`,{method:'POST',body:JSON.stringify(body)}))
   if(recovery.shiftId && result.shift_id!==recovery.shiftId)throw new Error('identity')
   resolved();setMessage(result.closed_at?'Drawer closed. The count and variance are recorded.':'Cash shift opened with the confirmed float.')
  }catch{setError('Result unconfirmed. Recover this request before opening or closing another shift.')}
  finally{flight.current=false;setBusy(false)}
 }
 async function recover(){if(flight.current || !pending)return;flight.current=true;setBusy(true);setError('')
  try {const result=CashResultSchema.parse(await apiFetch<unknown>('/api/cash/recover',{method:'POST',body:JSON.stringify(pending)}));resolved();setMessage(result.outcome==='COMPLETED'?'The original operation is confirmed.':'No operation committed. The old request is closed and cannot run late.')}
  catch{setError('Recovery could not be confirmed. Reconnect on the original terminal as the original operator.')}
  finally{flight.current=false;setBusy(false)}
 }
 async function review(id:string,notes:string){if(flight.current)return;flight.current=true;setBusy(true);setError('')
  try{CashShiftSchema.parse(await apiFetch<unknown>('/api/cash/review',{method:'POST',body:JSON.stringify({shiftId:id,notes})}));setRefresh(n=>n+1);setMessage('Independent variance review recorded.')}
  catch{setError('Review was not confirmed. Refresh the closed shift before retrying.')}
  finally{flight.current=false;setBusy(false)}
 }
 const shift=data?.current_shift
 return <main className="workspace"><header className="workspace-header"><div><p className="eyebrow">Physical cash controls</p><h1>Cash register</h1><p>Opening float + settled cash sales − recorded cash payouts = expected closing cash.</p></div><button className="secondary-action" onClick={()=>setRefresh(n=>n+1)}>Refresh cash register</button></header>
  {error && <p role="alert" className="error-message">{error}</p>}{message && <p role="status">{message}</p>}
  {pending && <section className="panel"><h2>Unresolved cash operation</h2><p>Recover the original {pending.operation.toLowerCase()} request before submitting new counts.</p><button className="primary-action" disabled={busy || !writer} onClick={()=>void recover()}>Recover cash result</button></section>}
  {data && <section className="panel"><h2>Current terminal</h2><p>{data.terminal_id}</p>{shift?<><p>Opening float {formatWon(shift.opening_float_won)} · cash sales {formatWon(shift.cash_sales_won)} · cash payouts {formatWon(shift.cash_payouts_won)}</p><p>Expected cash: <strong>{formatWon(shift.expected_won)}</strong></p></>:<p>No open shift at this terminal.</p>}
   {!enabled || !data.enabled ? <p role="status">New cash shifts are disabled. Existing shifts may still be closed and recovered.</p>:null}
   {!pending && ready && writer && (shift || (enabled && data.enabled)) && <CashCountForm key={shift?.shift_id??'new'} closing={Boolean(shift)} busy={busy} onSubmit={(counts,notes)=>void submit(counts,notes)} />}
   {!writer && <p>Accountant review view. Opening and counting drawers is performed by the terminal operator.</p>}
   <p className="muted">This drawer covers checkout cash and recorded refund payouts only. Do not take wallet deposits, remove cash, or transfer a drawer without an approved recorded workflow.</p>
  </section>}
  <CashHistory rows={data?.closed_shifts??[]} userId={userId} canReview={['accountant','super_admin'].includes(role)} busy={busy} onReview={(id,notes)=>void review(id,notes)} />
  <div className="action-row"><button className="secondary-action" disabled={busy || offset===0} onClick={()=>setOffset(n=>Math.max(0,n-50))}>Previous closes</button><span>{offset+1}–{offset+(data?.closed_shifts.length??0)} of {data?.total_closed??0}</span><button className="secondary-action" disabled={busy || offset+50>=(data?.total_closed??0)} onClick={()=>setOffset(n=>n+50)}>Next closes</button></div>
 </main>
}
