'use client'
import type { Permission } from '@/features/auth/domain'
import { PRESET_LABELS,PRESET_DEFAULTS,accessDiff,type AccessPreset } from '@/features/auth/capabilities'
import { AccessEditor } from '@/features/access/AccessEditor'
import { useCallback,useEffect,useRef,useState } from 'react'
import { apiFetch,ClientApiError } from '@/lib/api/client'
import { AdministrationRecoverySchema,type AdministrationSnapshot,type AdministrationResult,type AdministrationChange } from '../domain'
import { AdministrationForm,type AdministrationTarget } from './AdministrationForm'
const storageKey='campuspay:administration-operation:v1'
export function AdministrationScreen({enabled,userId,permissions,preset}:{enabled:boolean;userId:string;permissions:readonly Permission[];preset:AccessPreset}) {
 const [snapshot,setSnapshot]=useState<AdministrationSnapshot|null>(null),[error,setError]=useState(''),[message,setMessage]=useState(''),[busy,setBusy]=useState(false)
 const [staffOffset,setStaffOffset]=useState(0),[terminalOffset,setTerminalOffset]=useState(0),[pending,setPending]=useState<string|null>(null),[target,setTarget]=useState<AdministrationTarget|null>(null)
 const [editorKey,setEditorKey]=useState(0),[accessTarget,setAccessTarget]=useState<string|null>(null)
 const canStaff=permissions.includes('staff.manage'),canTerminals=permissions.includes('terminals.manage'),canAccess=preset==='super_admin'&&permissions.includes('staff.access.manage')
 const [storageReady,setStorageReady]=useState(false),[storageBlocked,setStorageBlocked]=useState(false)
 const working=useRef(false),generation=useRef(0)
 function selectTarget(next:AdministrationTarget){
  // A selection is a fresh editing session, even for the same entity. Values
  // and optimistic preconditions must come from the same immutable snapshot.
  setTarget(structuredClone(next));setEditorKey(n=>n+1)
 }
 const invalidateRefresh=useCallback(()=>{generation.current++},[])
 const refresh=useCallback(async()=>{
  const revision=++generation.current
  const data=await apiFetch<AdministrationSnapshot>(`/api/administration?staffOffset=${staffOffset}&terminalOffset=${terminalOffset}`)
  if(revision===generation.current)setSnapshot(data)
 },[staffOffset,terminalOffset])
 useEffect(()=>{let active=true;void Promise.resolve().then(()=>{
  try{
   const raw=sessionStorage.getItem(storageKey)
   if(raw){const parsed=AdministrationRecoverySchema.safeParse(JSON.parse(raw));if(!parsed.success)throw new Error('Invalid recovery record');if(active)setPending(parsed.data.requestKey)}
   if(active)setStorageReady(true)
  }catch{if(active){setStorageBlocked(true);setError('Recovery storage is unreadable or unavailable. Do not repeat an uncertain change; have its audit history checked.')}}
 });return()=>{active=false}},[])
 useEffect(()=>{let active=true;void Promise.resolve().then(()=>{if(active)void refresh().catch(()=>{if(active)setError('The administrative directory could not load. Refresh after the migration and activation have been reviewed.')})});return()=>{active=false;invalidateRefresh()}},[refresh,invalidateRefresh])
 function clearPending(){
  try{sessionStorage.removeItem(storageKey);setPending(null);return true}
  catch{setStorageBlocked(true);setError('The recorded outcome is confirmed, but browser recovery storage could not be cleared. Do not submit another change in this browser.');return false}
 }
 function finish(result:AdministrationResult){
  clearPending();setTarget(null)
  setMessage(result.outcome==='CLOSED'?'The unconfirmed request was closed without a change.':`Change recorded. ${result.sessions_revoked??0} sessions signed out. Reference: ${result.audit_reference??'see audit history'}`)
 }
 async function refreshAfterConfirmed(){try{await refresh()}catch{setError('The change is confirmed. The directory refresh failed; refresh the directory before making another change.');setSnapshot(null)}}
 async function submit(input:AdministrationChange){
  if(working.current||pending||!storageReady||storageBlocked)return
  working.current=true;setBusy(true);setError('');setMessage('')
  try{sessionStorage.setItem(storageKey,JSON.stringify({requestKey:input.requestKey}));setPending(input.requestKey)}
  catch{setStorageBlocked(true);setError('Safe recovery storage is unavailable; nothing was submitted.');working.current=false;setBusy(false);return}
  let confirmed=false
  try{finish(await apiFetch<AdministrationResult>('/api/administration',{method:'POST',body:JSON.stringify(input)}));confirmed=true}
  catch(e){
   // A 4xx response from this route is an authoritative rejected transaction.
   // Network/5xx uncertainty retains the opaque key and requires recovery.
   if(e instanceof ClientApiError&&e.status<500){if(clearPending())setError(e.message)}
   else setError('The result is unconfirmed. Recover it before submitting another change.')
  }finally{working.current=false;setBusy(false)}
  if(confirmed)await refreshAfterConfirmed()
 }
 async function recover(){
  if(!pending||working.current)return
  working.current=true;setBusy(true);setError('');let confirmed=false
  try{finish(await apiFetch<AdministrationResult>('/api/administration/recover',{method:'POST',body:JSON.stringify({requestKey:pending})}));confirmed=true}
  catch(e){setError(e instanceof ClientApiError?e.message:'Recovery could not be confirmed. Keep this request and try recovery again.')}
  finally{working.current=false;setBusy(false)}
  if(confirmed)await refreshAfterConfirmed()
 }
 const canEditTarget=target&&(target.kind==='TERMINAL'?canTerminals:target.kind==='CREATE'?canAccess:canStaff&&target.record.user_id!==userId)
 const canChange=enabled&&snapshot?.enabled&&!pending&&!busy&&storageReady&&!storageBlocked
 return <main className="workspace"><header className="workspace-header"><div><p className="eyebrow">Administration</p><h1>Staff and terminals</h1><p className="muted">Named accounts, exact employee access, registers, and session controls.</p></div><button className="secondary-action" disabled={busy} onClick={()=>void refresh().catch(()=>setError('Refresh failed; existing records may be stale.'))}>Refresh directory</button></header>
  {(!enabled||snapshot?.enabled===false)&&<p className="notice" role="status">The directory is read-only. Staff changes require both application and database activation; ask the deployment administrator to complete the reviewed setup. Existing accounts and history are still visible.</p>}
  {error&&<p className="error-message" role="alert">{error}</p>}{message&&<p role="status">{message}</p>}
  {pending&&<section className="uncertain-result"><h2>Administrative result needs confirmation</h2><p>Recovery returns the recorded outcome or closes the request so a delayed submission cannot apply afterward. No PIN is stored in browser recovery data.</p><button disabled={busy} onClick={()=>void recover()}>Recover administrative result</button></section>}
  {snapshot&&<>{permissions.includes('staff.read')&&<section className="panel"><h2>Staff directory</h2><p>Staff sign in with an employee code. Students use their card and PIN under Students. Deactivate staff instead of deleting identities linked to transactions.</p>{canAccess&&<button className="primary-action" disabled={!canChange} onClick={()=>selectTarget({kind:'CREATE'})}>Create employee</button>}<div className="table-scroll"><table><thead><tr><th>Name / code</th><th>Role</th><th>Access</th><th>Manage</th></tr></thead><tbody>{snapshot.staff.map(r=><tr key={r.user_id}><td>{r.display_name}<small>{r.employee_code}</small></td><td>{PRESET_LABELS[r.preset]}<small>{accessDiff(PRESET_DEFAULTS[r.preset],r.permissions).added.length||accessDiff(PRESET_DEFAULTS[r.preset],r.permissions).removed.length?'Customized':'Preset defaults'}</small></td><td>{r.active?'Active':'Inactive'} · {r.has_pin?'PIN set':'No PIN'}</td><td>{(canStaff||canAccess)?<button className="table-link" onClick={()=>selectTarget({kind:'STAFF',record:r})}>Open employee</button>:<span>View only</span>}{r.user_id===userId&&<small>Your current account</small>}</td></tr>)}</tbody></table></div><p>Showing {snapshot.staff.length?staffOffset+1:0}–{staffOffset+snapshot.staff.length} of {snapshot.staff_total} staff.</p><button disabled={busy||staffOffset===0} onClick={()=>setStaffOffset(n=>Math.max(0,n-50))}>Previous staff page</button><button disabled={busy||staffOffset+50>=snapshot.staff_total} onClick={()=>setStaffOffset(n=>n+50)}>Next staff page</button></section>}
  {permissions.includes('terminals.read')&&<section className="panel"><h2>Registered terminals</h2><p>Terminals appear after staff sign-in. Revocation applies to that browser token, not a physical-device ban.</p><div className="table-scroll"><table><thead><tr><th>Label / identifier</th><th>Access</th><th>Cash drawer</th><th>Manage</th></tr></thead><tbody>{snapshot.terminals.map(r=><tr key={r.terminal_id}><td>{r.label??'Unlabelled terminal'}<small>{r.terminal_id}</small>{r.terminal_id===snapshot.current_terminal_id&&<small>Your terminal</small>}</td><td>{r.active?'Active':'Inactive'}</td><td>{r.has_open_shift?'Open — close before deactivation':'No open shift'}</td><td>{canTerminals&&<button disabled={!canChange} onClick={()=>selectTarget({kind:'TERMINAL',record:r,isCurrent:r.terminal_id===snapshot.current_terminal_id})}>Manage terminal</button>}</td></tr>)}</tbody></table></div><p>Showing {snapshot.terminals.length?terminalOffset+1:0}–{terminalOffset+snapshot.terminals.length} of {snapshot.terminal_total} terminals.</p><button disabled={busy||terminalOffset===0} onClick={()=>setTerminalOffset(n=>Math.max(0,n-50))}>Previous terminal page</button><button disabled={busy||terminalOffset+50>=snapshot.terminal_total} onClick={()=>setTerminalOffset(n=>n+50)}>Next terminal page</button></section>}</>}
  {target?.kind==='STAFF'&&<section className="panel"><h2>{target.record.display_name}</h2><p>{target.record.employee_code} · {PRESET_LABELS[target.record.preset]}</p>{canAccess&&<button className="secondary-action" disabled={busy||!!pending} onClick={()=>setAccessTarget(target.record.user_id)}>Access</button>}</section>}
  {canEditTarget&&(!pending||busy)&&target&&<AdministrationForm key={editorKey} target={target} busy={busy} onSubmit={submit} onCancel={()=>setTarget(null)} />}
  {accessTarget&&<AccessEditor targetId={accessTarget} currentUserId={userId} enabled={Boolean(enabled&&snapshot?.enabled)} canReadAudit={permissions.includes('audit.read')} onClose={()=>setAccessTarget(null)} onChanged={refresh}/>}
 </main>
}
