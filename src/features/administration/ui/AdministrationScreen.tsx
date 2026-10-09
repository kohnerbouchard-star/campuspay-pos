'use client'
import type { Permission } from '@/features/auth/domain'
import { PRESET_LABELS,PRESET_DEFAULTS,accessDiff,type AccessPreset } from '@/features/auth/capabilities'
import { AccessSnapshotSchema } from '@/features/access/domain'
import { AccessEditor } from '@/features/access/AccessEditor'
import { EffectiveAccess } from '@/features/access/EffectiveAccess'
import { useCallback,useEffect,useRef,useState } from 'react'
import { apiFetch,ClientApiError } from '@/lib/api/client'
import { AdministrationRecoverySchema,AdministrationSnapshotSchema,type StaffRecord,type AdministrationSnapshot,type AdministrationResult,type AdministrationChange } from '../domain'
import { AdministrationForm,type AdministrationTarget } from './AdministrationForm'
const storageKey='campuspay:administration-operation:v1'
export function AdministrationScreen({enabled,userId,permissions,preset}:{enabled:boolean;userId:string;permissions:readonly Permission[];preset:AccessPreset}) {
 const [snapshot,setSnapshot]=useState<AdministrationSnapshot|null>(null),[error,setError]=useState(''),[message,setMessage]=useState(''),[busy,setBusy]=useState(false)
 const [staffOffset,setStaffOffset]=useState(0),[terminalOffset,setTerminalOffset]=useState(0),[pending,setPending]=useState<string|null>(null),[target,setTarget]=useState<AdministrationTarget|null>(null)
 const [editorKey,setEditorKey]=useState(0),[accessTarget,setAccessTarget]=useState<string|null>(null)
 const [summary,setSummary]=useState<StaffRecord|null>(null),[summaryState,setSummaryState]=useState<'current'|'loading'|'stale'>('current')
 const selectedHeading=useRef<HTMLHeadingElement>(null),returnTarget=useRef('')
 useEffect(()=>{if(target?.kind==='STAFF'){selectedHeading.current?.focus();selectedHeading.current?.scrollIntoView({block:'start'})}else if(!target&&returnTarget.current){document.getElementById(returnTarget.current)?.focus()}},[target])
 const staleAccessIds=useRef(new Set<string>())
 const summaryGeneration=useRef(0),summaryFlight=useRef<{id:string;promise:Promise<void>}|null>(null)
 const canStaff=permissions.includes('staff.manage'),canTerminals=permissions.includes('terminals.manage'),canAccess=preset==='super_admin'&&permissions.includes('staff.access.manage')
 const [storageReady,setStorageReady]=useState(false),[storageBlocked,setStorageBlocked]=useState(false)
 const working=useRef(false),generation=useRef(0)
 function selectTarget(next:AdministrationTarget){
  returnTarget.current=next.kind==='STAFF'?`staff-open-${next.record.user_id}`:next.kind==='TERMINAL'?`terminal-open-${next.record.terminal_id}`:'create-employee'
  // A selection is a fresh editing session, even for the same entity. Values
  // and optimistic preconditions must come from the same immutable snapshot.
  summaryGeneration.current++;summaryFlight.current=null;setSummary(next.kind==='STAFF'?structuredClone(next.record):null);setSummaryState(next.kind==='STAFF'&&staleAccessIds.current.has(next.record.user_id)?'stale':'current')
  setTarget(structuredClone(next));setEditorKey(n=>n+1)
 }
 const invalidateRefresh=useCallback(()=>{generation.current++},[])
 const refresh=useCallback(async()=>{
  const revision=++generation.current
  const data=AdministrationSnapshotSchema.parse(await apiFetch<unknown>(`/api/administration?staffOffset=${staffOffset}&terminalOffset=${terminalOffset}`))
  if(revision===generation.current){setSnapshot(data);setSummary(current=>{const row=data.staff.find(r=>r.user_id===current?.user_id);return row&&current&&row.revision>=current.revision?row:current})}
 },[staffOffset,terminalOffset])
 // The profile editor intentionally retains its immutable target and optimistic
 // preconditions. Only the authoritative read display is replaced after access saves.
 function refreshAccessDisplay(id:string):Promise<void>{
  if(summaryFlight.current?.id===id)return summaryFlight.current.promise
  const requestGeneration=++summaryGeneration.current
  staleAccessIds.current.add(id);setSummaryState('loading')
  const promise=(async()=>{
   const results=await Promise.allSettled([
    apiFetch<unknown>(`/api/administration/access/${id}`).then(raw=>{
     const access=AccessSnapshotSchema.parse(raw)
     if(access.user_id!==id)throw new Error('Employee identity did not match')
     return access
    }),refresh(),
   ])
   if(requestGeneration!==summaryGeneration.current)return
   const [access,directory]=results
   if(access.status==='rejected'||directory.status==='rejected'){
    setSummaryState('stale');setError('The access change is confirmed, but the employee display could not refresh. Permissions shown in the directory may be stale. Retry the employee access refresh before relying on them.')
    throw new Error('Employee access display is stale')
   }
   setSummary(current=>current?.user_id===id?{...current,...access.value}:current)
   staleAccessIds.current.delete(id);setSummaryState('current');setError('')
  })()
  const flight={id,promise};summaryFlight.current=flight
  void promise.finally(()=>{if(summaryFlight.current===flight)summaryFlight.current=null}).catch(()=>{})
  return promise
 }
 useEffect(()=>()=>{summaryGeneration.current++;summaryFlight.current=null},[])
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
 const canEditTarget=enabled&&snapshot?.enabled&&target&&(target.kind==='TERMINAL'?canTerminals:target.kind==='CREATE'?canAccess:canStaff&&target.record.user_id!==userId)
 const canChange=enabled&&snapshot?.enabled&&!pending&&!busy&&storageReady&&!storageBlocked
 return <main className="workspace"><header className="workspace-header"><div><p className="eyebrow">Administration</p><h1>Staff and terminals</h1><p className="muted">Named accounts, exact employee access, registers, and session controls.</p></div><button className="secondary-action" disabled={busy} onClick={()=>void refresh().catch(()=>setError('Refresh failed; existing records may be stale.'))}>Refresh directory</button></header>
  {(!enabled||snapshot?.enabled===false)&&<p className="notice" role="status">The directory is read-only. Staff changes require both application and database activation; ask the deployment administrator to complete the reviewed setup. Existing accounts and history are still visible.</p>}
  {error&&<p className="error-message" role="alert">{error}</p>}{message&&<p role="status">{message}</p>}
  {pending&&<section className="uncertain-result"><h2>Administrative result needs confirmation</h2><p>Recovery returns the recorded outcome or closes the request so a delayed submission cannot apply afterward. No PIN is stored in browser recovery data.</p><button className="primary-action" disabled={busy} onClick={()=>void recover()}>Recover administrative result</button></section>}
  {snapshot&&!target&&<>{permissions.includes('staff.read')&&<section className="panel"><h2>Staff directory</h2><p>Staff sign in with an employee code. Students use their card and PIN under Students. Deactivate staff instead of deleting identities linked to transactions.</p>{canAccess&&<button id="create-employee" className="primary-action" disabled={!canChange} onClick={()=>selectTarget({kind:'CREATE'})}>Create employee</button>}<div className="table-scroll"><table><thead><tr><th>Name / code</th><th>Preset</th><th>Status</th></tr></thead><tbody>{snapshot.staff.map(r=><tr key={r.user_id}><td>{r.display_name}<small>{r.employee_code}</small><button id={`staff-open-${r.user_id}`} className="table-link" onClick={()=>selectTarget({kind:'STAFF',record:r})}>Open employee</button>{r.user_id===userId&&<small>Your current account</small>}</td><td>{PRESET_LABELS[r.preset]}<small>{accessDiff(PRESET_DEFAULTS[r.preset],r.permissions).added.length||accessDiff(PRESET_DEFAULTS[r.preset],r.permissions).removed.length?'Customized':'Preset defaults'}</small></td><td>{r.active?'Active':'Inactive'} · {r.has_pin?'PIN set':'No PIN'}</td></tr>)}</tbody></table></div><p>Showing {snapshot.staff.length?staffOffset+1:0}–{staffOffset+snapshot.staff.length} of {snapshot.staff_total} staff.</p><div className="action-row"><button className="secondary-action" disabled={busy||staffOffset===0} onClick={()=>setStaffOffset(n=>Math.max(0,n-50))}>Previous staff page</button><button className="secondary-action" disabled={busy||staffOffset+50>=snapshot.staff_total} onClick={()=>setStaffOffset(n=>n+50)}>Next staff page</button></div></section>}
  {permissions.includes('terminals.read')&&<section className="panel"><h2>Registered terminals</h2><p>Terminals appear after staff sign-in. Revocation applies to that browser token, not a physical-device ban.</p><div className="table-scroll"><table><thead><tr><th>Label / identifier</th><th>Access</th><th>Cash drawer</th></tr></thead><tbody>{snapshot.terminals.map(r=><tr key={r.terminal_id}><td>{r.label??'Unlabelled terminal'}<small>{r.terminal_id}</small>{r.terminal_id===snapshot.current_terminal_id&&<small>Your terminal</small>}{canTerminals&&<button id={`terminal-open-${r.terminal_id}`} className="table-link" disabled={!canChange} onClick={()=>selectTarget({kind:'TERMINAL',record:r,isCurrent:r.terminal_id===snapshot.current_terminal_id})}>Manage terminal</button>}</td><td>{r.active?'Active':'Inactive'}</td><td>{r.has_open_shift?'Open — close before deactivation':'No open shift'}</td></tr>)}</tbody></table></div><p>Showing {snapshot.terminals.length?terminalOffset+1:0}–{terminalOffset+snapshot.terminals.length} of {snapshot.terminal_total} terminals.</p><div className="action-row"><button className="secondary-action" disabled={busy||terminalOffset===0} onClick={()=>setTerminalOffset(n=>Math.max(0,n-50))}>Previous terminal page</button><button className="secondary-action" disabled={busy||terminalOffset+50>=snapshot.terminal_total} onClick={()=>setTerminalOffset(n=>n+50)}>Next terminal page</button></div></section>}</>}
  {target&&!canEditTarget&&<button className="secondary-action" disabled={busy||!!pending} onClick={()=>setTarget(null)}>Back to staff and registers</button>}
  {target?.kind==='STAFF'&&summary?.user_id===target.record.user_id&&<section className="panel" aria-label="Selected employee access" aria-busy={summaryState==='loading'}><h2 ref={selectedHeading} tabIndex={-1}>{summary.display_name}</h2><p>{summary.employee_code} · {summary.active?'Active':'Inactive'}</p>
   {summaryState==='current'?<><p>Current preset: {PRESET_LABELS[summary.preset]}</p><details><summary>View effective access ({summary.permissions.length} permissions)</summary><EffectiveAccess permissions={summary.permissions}/></details></>:<p role={summaryState==='stale'?'alert':'status'}>{summaryState==='loading'?'Refreshing authoritative employee access…':'Employee access display is stale. Current permissions could not be verified.'}</p>}
   {summaryState!=='current'&&canAccess&&<button className="secondary-action" disabled={summaryState==='loading'} onClick={()=>void refreshAccessDisplay(summary.user_id).catch(()=>{})}>Retry employee access refresh</button>}
   {summary.revision!==target.record.revision&&<p className="notice">Access changed. Unsaved profile edits are retained with their original concurrency checks; reopen the profile before submitting it if the server reports a stale editing snapshot.</p>}
   {canAccess&&<button className="secondary-action" disabled={busy||!!pending||summaryState!=='current'} onClick={()=>setAccessTarget(target.record.user_id)}>Access</button>}</section>}
  {canEditTarget&&(!pending||busy)&&target&&<AdministrationForm key={editorKey} focusOnMount={target.kind!=='STAFF'} target={target} busy={busy} onSubmit={submit} onCancel={()=>setTarget(null)} />}
  {accessTarget&&<AccessEditor targetId={accessTarget} currentUserId={userId} enabled={Boolean(enabled&&snapshot?.enabled)} canReadAudit={permissions.includes('audit.read')} onClose={()=>setAccessTarget(null)} onChanged={()=>refreshAccessDisplay(accessTarget)}/>}
 </main>
}
