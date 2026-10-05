'use client'
import { PRESETS,PRESET_LABELS,PRESET_DESCRIPTIONS,PRESET_DEFAULTS,type AccessPreset } from '@/features/auth/capabilities'
import { EffectiveAccess } from '@/features/access/EffectiveAccess'
import { ConfirmationDialog } from '@/components/ui/ConfirmationDialog'
import { administrationReview, ROLE_DESCRIPTIONS } from '../review'
import { useEffect, useId, useRef, useState } from 'react'
import { AdministrationChangeSchema,type AdministrationChange,type StaffRecord,type TerminalRecord } from '../domain'
export type AdministrationTarget = {kind:'CREATE'}|{kind:'STAFF';record:StaffRecord;initialActive?:boolean}|{kind:'TERMINAL';record:TerminalRecord;isCurrent?:boolean}
export function AdministrationForm({target,busy,onSubmit,onCancel}:{target:AdministrationTarget;busy:boolean;onSubmit(input:AdministrationChange):Promise<void>;onCancel():void}) {
 const id=useId(),[error,setError]=useState(''),[review,setReview]=useState<AdministrationChange|null>(null)
 const [selectedPreset,setSelectedPreset]=useState<AccessPreset>(target.kind==='STAFF'?target.record.preset:'staff')
 const summary=review?administrationReview(review,target.kind==='CREATE'?undefined:target.record):null
 useEffect(()=>{if(!review||busy)return;const timer=setTimeout(()=>{setReview(null);setError('Review expired. Re-enter the authorization PIN and review the current change.')},60000);return()=>clearTimeout(timer)},[review,busy])
 const [action,setAction]=useState(target.kind==='CREATE'?'CREATE_STAFF':target.kind==='STAFF'?'UPDATE_STAFF':'UPDATE_TERMINAL')
 const heading=useRef<HTMLHeadingElement>(null)
 useEffect(()=>{heading.current?.focus();heading.current?.scrollIntoView({block:'start'})},[])
 const pinNeeded=action==='CREATE_STAFF'||action==='RESET_STAFF_PIN'
 const presetRole={staff:'cashier',manager:'inventory_admin',accountant:'accountant',super_admin:'super_admin'} as const
 return <form aria-labelledby={`${id}-heading`} className="panel form-stack" onSubmit={async event=>{
  event.preventDefault();if(busy)return
  const form=event.currentTarget,data=new FormData(form),value=(name:string)=>String(data.get(name)??'')
  const input:Record<string,unknown>={action,requestKey:crypto.randomUUID(),adminPin:value('adminPin'),notes:value('notes'),verified:data.get('verified')==='yes'}
  if(target.kind==='STAFF')input.targetId=target.record.user_id
  if(target.kind==='TERMINAL')input.targetId=target.record.terminal_id
  if(action==='CREATE_STAFF')input.employeeCode=value('employeeCode')
  if(action==='CREATE_STAFF'||action==='UPDATE_STAFF'){input.displayName=value('displayName');input.role=target.kind==='STAFF'?target.record.role:presetRole[selectedPreset]}
  if(action==='CREATE_STAFF')input.preset=selectedPreset
  if(action==='UPDATE_STAFF'&&target.kind==='STAFF'){input.active=data.get('active')==='yes';input.expectedUpdatedAt=target.record.updated_at}
  if(pinNeeded){input.newPin=value('newPin');input.confirmationPin=value('confirmationPin')}
  if(action==='UPDATE_TERMINAL'&&target.kind==='TERMINAL'){input.label=value('label');input.active=target.isCurrent?target.record.active:data.get('active')==='yes';input.expectedActive=target.record.active;input.expectedLabel=target.record.label}
  const parsed=AdministrationChangeSchema.safeParse(input)
  if(!parsed.success){setError('Check all fields, matching numeric PINs, the reason (10–500 characters), and the confirmation.');return}
  setError('');for(const name of ['adminPin','newPin','confirmationPin']){const element=form.elements.namedItem(name);if(element instanceof HTMLInputElement)element.value=''}
  setReview(parsed.data)
 }}>
  <h2 id={`${id}-heading`} ref={heading} tabIndex={-1}>{target.kind==='CREATE'?'Create a named staff account':target.kind==='STAFF'?`${target.record.display_name} · ${target.record.employee_code}`:`Terminal · ${target.record.label??target.record.terminal_id}`}</h2>
  <p>No student account, card, wallet, or student PIN is changed here. Staff credentials are handed to the verified staff member separately.</p>
  {error&&<p className="error-message" role="alert">{error}</p>}
  <fieldset disabled={busy} className="form-fields"><legend>Deliberate administrative change</legend>
   {target.kind!=='CREATE'&&<><label htmlFor={`${id}-action`}>Action</label><select id={`${id}-action`} value={action} onChange={e=>setAction(e.target.value)}>{target.kind==='STAFF'?<><option value="UPDATE_STAFF">Update name or active status</option><option value="RESET_STAFF_PIN">Reset staff PIN and sign out sessions</option><option value="REVOKE_STAFF_SESSIONS">Sign out staff sessions</option></>:<><option value="UPDATE_TERMINAL">Update terminal label or active status</option><option value="REVOKE_TERMINAL_SESSIONS" disabled={target.kind==='TERMINAL'&&target.isCurrent}>Sign out this terminal</option></>}</select></>}
   {action==='CREATE_STAFF'&&<label className="field"><span>Employee code (permanent)</span><input name="employeeCode" required minLength={2} maxLength={32} pattern="[A-Za-z0-9_-]+" autoComplete="off" /></label>}
   {(action==='CREATE_STAFF'||action==='UPDATE_STAFF')&&<><label className="field"><span>Staff display name</span><input name="displayName" required maxLength={120} defaultValue={target.kind==='STAFF'?target.record.display_name:''} /></label>{action==='CREATE_STAFF'?<><label htmlFor={`${id}-preset`}>Access preset</label><select id={`${id}-preset`} value={selectedPreset} onChange={e=>setSelectedPreset(e.target.value as AccessPreset)}>{PRESETS.map(p=><option key={p} value={p}>{PRESET_LABELS[p]}</option>)}</select><p>{PRESET_DESCRIPTIONS[selectedPreset]}</p><EffectiveAccess permissions={PRESET_DEFAULTS[selectedPreset]}/></>:<p>Preset: {PRESET_LABELS[selectedPreset]}. Change exact permissions in Employee → Access.</p>}</>}
   {action==='UPDATE_TERMINAL'&&target.kind==='TERMINAL'&&<label className="field"><span>Terminal label</span><input name="label" required maxLength={120} defaultValue={target.record.label??''} /></label>}
   {(action==='UPDATE_STAFF'||action==='UPDATE_TERMINAL')&&target.kind!=='CREATE'&&<label><input type="checkbox" name="active" disabled={target.kind==='TERMINAL'&&target.isCurrent} value="yes" defaultChecked={target.kind==='STAFF'?(target.initialActive??target.record.active):target.record.active} /> Active — allow this staff member or terminal to sign in</label>}
   {pinNeeded&&<><label className="field"><span>New staff PIN</span><input type="password" name="newPin" inputMode="numeric" autoComplete="new-password" required minLength={4} maxLength={16} pattern="[0-9]+" /></label><label className="field"><span>Confirm new staff PIN</span><input type="password" name="confirmationPin" inputMode="numeric" autoComplete="new-password" required minLength={4} maxLength={16} pattern="[0-9]+" /></label></>}
   <label className="field"><span>Reason and verification evidence</span><textarea name="notes" required minLength={10} maxLength={500} /></label>
   <label className="field"><span>Your current administrator PIN</span><input name="adminPin" type="password" inputMode="numeric" autoComplete="current-password" required minLength={4} maxLength={16} pattern="[0-9]+" /></label>
   <label><input type="checkbox" name="verified" value="yes" required /> I verified the person or terminal and approve this exact change.</label>
   {target.kind==='TERMINAL'&&target.isCurrent&&<p className="notice">This is your current register. You can rename it here, but must use a different register to deactivate it or sign out its sessions.</p>}
   <p className="muted">Changes are audited. Staff changes sign out that person. Terminal changes sign out that terminal; renaming your active terminal keeps your session. An open cash shift must be closed before deactivation or a cashier role change.</p>
   <button className="primary-action">{busy?'Applying change…':'Apply verified change'}</button><button type="button" className="secondary-action" onClick={onCancel}>Cancel</button>
  </fieldset>
 {review&&summary&&<ConfirmationDialog title={`${summary.label}?`} description={summary.description} confirmLabel={summary.label} cancelLabel="Go back" destructive={summary.destructive} confirmationText={summary.token} onCancel={()=>setReview(null)} onConfirm={async()=>{const input=review;await onSubmit(input);setReview(null)}}><p>Reason: {review.notes}</p>{'role' in review&&<p>{ROLE_DESCRIPTIONS[review.role]}</p>}</ConfirmationDialog>}
 </form>
}
