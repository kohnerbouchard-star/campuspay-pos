'use client'
import { useCallback,useEffect,useRef,useState } from 'react'
import type { LeaveState } from '@/components/ui/leave-state'
import { useFundingReadiness } from './useFundingReadiness'
import { z } from 'zod'
import type { Permission } from '@/features/auth/domain'
import type { ManagedStudent } from '@/features/students/domain'
import { apiFetch,ClientApiError } from '@/lib/api/client'
import { businessDate } from '@/lib/format/business-time'
import { ConfirmFundingSchema,FundingKeySchema,FundingIntentSchema,FundingResultSchema,FundingHistorySchema,type FundingAction,type FundingIntent,type FundingReceipt,type FundingHistory,type PrepareFunding } from '../domain'
import { FundingForm } from './FundingForm'
import { FundingConfirm } from './FundingConfirm'
import { FundingJournal,FundingReceiptView } from './FundingJournal'
const storageKey='campuspay:funding-operation:v1'
export function FundingScreen({enabled,permissions,student,cashOnly=false,onPosted,onLeaveStateChange}:{enabled:boolean;permissions:readonly Permission[];student?:ManagedStudent;cashOnly?:boolean;onPosted?():void|Promise<void>;onLeaveStateChange?(state:LeaveState):void}){
 const [ready,setReady]=useState(false),[blocked,setBlocked]=useState(false),[pending,setPending]=useState<string|null>(null),[intent,setIntent]=useState<FundingIntent|null>(null)
 const [receipt,setReceipt]=useState<FundingReceipt|null>(null),[data,setData]=useState<FundingHistory|null>(null),[busy,setBusy]=useState(false),[uncertain,setUncertain]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('')
 const [from,setFrom]=useState(()=>businessDate(new Date())),[to,setTo]=useState(()=>businessDate(new Date())),[offset,setOffset]=useState(0),[revision,setRevision]=useState(0)
 const [draftState,setDraftState]=useState<LeaveState>('clean')
 const flight=useRef(false)
 const actions:FundingAction[]=student?['CASH_DEPOSIT']:cashOnly?['PAID_IN','PAID_OUT','CASH_DROP']:['NONCASH_CREDIT','ADMIN_DEBIT','REVERSE_FUNDING']
 const allowedActions=actions.filter(a=>permissions.includes(a==='CASH_DEPOSIT'?'wallet.fund':a==='REVERSE_FUNDING'?'wallet.reverse':['NONCASH_CREDIT','ADMIN_DEBIT'].includes(a)?'wallet.correct':'cash.movement.record'))
 const studentId=student?.student_id
 const readinessRequest=useFundingReadiness(studentId,revision)
 const readiness=readinessRequest.data
 const fundingReady=Boolean(enabled&&readiness&&Object.entries(readiness).every(([k,v])=>k==='pin_locked'?!v:v))
 useEffect(()=>{onLeaveStateChange?.(!ready||blocked||busy||pending?'pending':draftState)},[ready,blocked,busy,pending,draftState,onLeaveStateChange])
 useEffect(()=>{const timer=setTimeout(()=>{
  try{const raw=sessionStorage.getItem(storageKey);if(raw){setPending(FundingKeySchema.parse(JSON.parse(raw)).requestKey);setUncertain(true)}setReady(true)}
  catch{setBlocked(true);setError('Recovery storage is unavailable or corrupt. Do not start another operation; have the existing request checked.')}
 },0);return()=>clearTimeout(timer)},[])
 useEffect(()=>{let current=true
  if(studentId)return()=>{current=false};
  void apiFetch<unknown>(`/api/funding?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&offset=${offset}`).then(v=>{if(current)setData(FundingHistorySchema.parse(v))}).catch(e=>{if(current){setData(null);setError(e instanceof Error?e.message:'Journal unavailable')}})
  return()=>{current=false}
 },[from,to,offset,revision,studentId])
 function clear(){
  setIntent(null);setUncertain(false);setDraftState('clean')
  try{sessionStorage.removeItem(storageKey);if(sessionStorage.getItem(storageKey)!==null)throw new Error('storage');setPending(null)}
  catch{setBlocked(true);setError('The outcome is confirmed, but browser recovery storage could not be cleared. Do not start another operation in this browser.')}
  setRevision(n=>n+1)
 }
 function result(v:unknown){const r=FundingResultSchema.parse(v)
  if(r.outcome==='REJECTED')throw new Error('Verification rejected')
  if(r.outcome==='COMPLETED'){setReceipt(r.receipt);setMessage(`Recorded ${r.receipt.reference_number}.`);void Promise.resolve(onPosted?.()).catch(()=>setError('The receipt is confirmed. Refresh student details to see the latest balance.'))}else setMessage('No funding operation committed. The old request is closed and cannot run late.')
  clear()
 }
 async function prepare(v:PrepareFunding){
  if(flight.current||pending||blocked||!ready||!allowedActions.includes(v.action)||(studentId&&!fundingReady))return
  setError('');setMessage('');setReceipt(null)
  try{const raw=JSON.stringify({requestKey:v.requestKey});sessionStorage.setItem(storageKey,raw);if(sessionStorage.getItem(storageKey)!==raw)throw new Error('storage')}
  catch{setBlocked(true);setError('Recovery storage could not be saved. Nothing was submitted.');return}
  setPending(v.requestKey);flight.current=true;setBusy(true)
  try{const next=FundingIntentSchema.parse(await apiFetch<unknown>(studentId?`/api/students/${studentId}/funding`:'/api/funding/prepare',{method:'POST',body:JSON.stringify(v)}));setIntent(next);setUncertain(!['PREPARED','SCANNED'].includes(next.state))}
  catch(e){setUncertain(true);setError(e instanceof Error?e.message:'Preparation result unknown. Recover the request.')}
  finally{flight.current=false;setBusy(false)}
 }
 const scan=useCallback(async(cardRead:string)=>{
  if(flight.current||!intent||(studentId&&!fundingReady))return;flight.current=true;setBusy(true);setError('')
  try{setIntent(FundingIntentSchema.parse(await apiFetch<unknown>('/api/funding/card',{method:'POST',body:JSON.stringify({requestKey:intent.request_key,cardRead})})))}
  catch(e){setError(e instanceof Error?e.message:'Card verification failed')}
  finally{flight.current=false;setBusy(false)}
 },[intent,studentId,fundingReady])
 async function confirm(v:z.infer<typeof ConfirmFundingSchema>){
  if(flight.current||!intent||uncertain||(studentId&&!fundingReady))return;flight.current=true;setBusy(true);setError('')
  try{result(await apiFetch<unknown>('/api/funding/confirm',{method:'POST',body:JSON.stringify(v)}))}
  catch(e){if(!(e instanceof ClientApiError)||e.status>=500){setUncertain(true);setError('The result is unknown. Recover it before returning cash or starting another operation.')}else setError(e.message)}
  finally{flight.current=false;setBusy(false)}
 }
 async function recover(){
  if(flight.current||!pending)return;flight.current=true;setBusy(true);setError('')
  try{result(await apiFetch<unknown>('/api/funding/recover',{method:'POST',body:JSON.stringify({requestKey:pending})}))}
  catch(e){setUncertain(true);setError(e instanceof Error?e.message:'Recovery was not confirmed. Use the original operator and terminal.')}
  finally{flight.current=false;setBusy(false)}
 }

 const Container=student?'section':'main',Heading=student?'h2':'h1'
 return <Container className="workspace"><header className="workspace-header"><div><p className="eyebrow">Recorded funds and physical cash</p><Heading>{student?'Add Funds':cashOnly?'Cash movements':'Funding history and corrections'}</Heading><p>{student?`${student.display_name} · ${student.student_code}`:cashOnly?'Record movements for this register’s cash drawer.':'Review receipts and initiate independently approved corrections.'}</p></div>{permissions.includes('cash.shift.manage')&&<a className="secondary-action" href="/cash">Open or close cash drawer</a>}</header>
 {(!enabled||data?.enabled===false||readiness?.database_enabled===false)&&<p className="notice" role="status">Wallet funding is not activated for this installation. No balance has changed. Existing history and recovery remain available.</p>}
 {error&&<p className="error-message" role="alert">{error}</p>}{message&&<p className="success-message" role="status">{message}</p>}
 {pending&&(!intent||uncertain)&&<section className="panel"><h2>Funding result needs confirmation</h2><p>The browser stores only the request ID, never a card or PIN. Recover before repeating or handing cash back.</p><button className="primary-action" disabled={busy} onClick={()=>void recover()}>Recover funding result</button></section>}
 {student&&<section className="panel" aria-label="Student funding readiness" aria-busy={readinessRequest.loading}>
  <h2>{fundingReady?'Funding readiness':'Student funding unavailable'}</h2>
  {readinessRequest.loading&&<p role="status">Checking current funding readiness…</p>}
  {readinessRequest.error&&<p className="error-message" role="alert">{readinessRequest.error} No deposit can be prepared until these checks succeed.</p>}
  <button className="secondary-action" disabled={busy||readinessRequest.loading} onClick={()=>void readinessRequest.retry()}>{readinessRequest.error?'Retry funding readiness':'Refresh funding readiness'}</button>
  {readiness&&<details open={!fundingReady}><summary>{fundingReady?'Ready to accept a deposit · view checks':'Review funding blockers'}</summary><dl className="detail-list">{[['Funding service',enabled],['Database funding',readiness.database_enabled],['Cash controls',readiness.cash_enabled],['Drawer open',readiness.drawer_open],['Drawer assigned to you',readiness.drawer_assigned],['Student active',readiness.student_active],['Card ready',readiness.card_ready],['PIN ready',readiness.pin_ready],['PIN unlocked',!readiness.pin_locked]].map(([label,value])=><div key={String(label)}><dt>{label}</dt><dd>{value?'Ready':'Unavailable'}</dd></div>)}</dl>{!readiness.drawer_open&&<p>Open this register’s cash drawer to accept a cash deposit, or ask an assigned operator for assistance.</p>}{!readiness.pin_ready&&<p>Initial credential setup is incomplete. Reset PIN cannot issue the first PIN.</p>}</details>}
 </section>}
 {!pending&&ready&&!blocked&&allowedActions.length>0&&<FundingForm key={`form:${revision}`} actions={allowedActions} busy={busy} available={student?fundingReady:Boolean(enabled&&data?.enabled)} onLeaveStateChange={setDraftState} onPrepare={v=>void prepare(v)}/>}
 {intent&&!uncertain&&<FundingConfirm intent={intent} busy={busy} unavailable={Boolean(studentId&&!fundingReady)} onScan={scan} onConfirm={v=>void confirm(v)} onRecover={()=>void recover()}/>}
 {receipt&&<FundingReceiptView receipt={receipt}/>}
 {!student&&<section className="panel form-stack"><h2>Journal date range</h2><label className="field"><span>From (Korea)</span><input type="date" value={from} onChange={e=>{setFrom(e.target.value);setOffset(0)}}/></label><label className="field"><span>To (Korea)</span><input type="date" value={to} onChange={e=>{setTo(e.target.value);setOffset(0)}}/></label><button className="secondary-action" disabled={busy} onClick={()=>setRevision(n=>n+1)}>Refresh funding journal</button></section>}
 {data&&<FundingJournal key={`${data.from}:${data.to}:${revision}`} data={data} offset={offset} busy={busy} onPage={setOffset}/>}
 </Container>
}
