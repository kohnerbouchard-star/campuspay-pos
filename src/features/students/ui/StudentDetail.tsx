'use client'
import { useEffect, useState } from 'react'
import type { LeaveState } from '@/components/ui/leave-state'
import { ConfirmationDialog } from '@/components/ui/ConfirmationDialog'
import Link from 'next/link'
import type { Permission } from '@/features/auth/domain'
import { RecordManager } from '@/features/management/RecordManager'
import { Dialog } from '@/components/ui/Dialog'
import { FundingScreen } from '@/features/funding/ui/FundingScreen'
import { WalletHistory } from '@/features/wallets/ui/WalletHistory'
import { businessDate, formatBusinessTime } from '@/lib/format/business-time'
import type { ManagedStudent } from '@/features/students/domain'
import { formatWon } from '@/lib/format/currency'
import { isStaffSessionExiting } from '@/features/terminal/session-exit'
export function StudentDetail({student,userId,permissions,fundingEnabled,onChanged,onClose,refreshError=''}:{student:ManagedStudent;userId:string;permissions:readonly Permission[];fundingEnabled:boolean;onChanged():void|Promise<void>;onClose():void;refreshError?:string}) {
 const [view,setView]=useState<'funding'|'history'|'status'|null>(null)
 const [childState,setChildState]=useState<LeaveState>('pending')
 const [leaveAction,setLeaveAction]=useState<(()=>void)|null>(null),[leaveError,setLeaveError]=useState('')
 const state:LeaveState=view==='funding'||view==='status'?childState:'clean'
 useEffect(()=>{
  const overflow=document.body.style.overflow
  document.body.style.overflow='hidden'
  return()=>{document.body.style.overflow=overflow}
 },[])
 useEffect(()=>{
  if(state==='clean')return
  const warn=(event:BeforeUnloadEvent)=>{if(!isStaffSessionExiting()){event.preventDefault();event.returnValue=''}}
  window.addEventListener('beforeunload',warn)
  return()=>window.removeEventListener('beforeunload',warn)
 },[state])
 function requestLeave(action:()=>void){
  if(state==='pending'){setLeaveError('An operation or recovery check is unresolved. Keep this student open and recover the original result before closing or changing views.');return}
  if(state==='dirty'){setLeaveAction(()=>action);return}
  setLeaveError('');action()
 }
 function openView(next:typeof view){
  // Reopening the selected view must not manufacture an unresolved operation.
  // Actual pending child work remains protected by requestLeave when switching views.
  if(next===view)return
  requestLeave(()=>{setChildState('pending');setView(next)})
 }
 const warning=leaveError&&state!=='clean'&&<p className="error-message" role="alert">{leaveError}</p>
 const can=(p:Permission)=>permissions.includes(p)
 return <Dialog title={`Student account · ${student.display_name} · ${student.student_code}`} className="student-detail-dialog"
  onClose={()=>requestLeave(onClose)} returnFocus={()=>{const row=document.getElementById(`student-select-${student.student_id}`);(row&&!row.matches(':disabled')?row:document.getElementById('student-directory-search'))?.focus({preventScroll:true})}}>
  <section className="panel student-detail-content" aria-labelledby="student-detail-heading" onClickCapture={event=>{
   const link=(event.target as Element).closest('a[href]')
   // Full-page reauthentication retains recovery storage and the unload warning.
   if(link instanceof HTMLAnchorElement&&new URL(link.href).pathname==='/login')return
   if(link&&state!=='clean'){
    event.preventDefault();event.stopPropagation()
    setLeaveError('Keep this student open. Finish or recover the current action, or explicitly discard its unsubmitted draft before following another link.')
   }
  }}>
  <p className="eyebrow">Student account</p><h2 id="student-detail-heading">{student.display_name}</h2>
  <p className="muted">{student.student_code}{student.year_group?` · Y${student.year_group}`:''}</p>
  <div className="action-row">
   {can('wallet.fund')&&<button className="primary-action" onClick={()=>openView('funding')}>Add Funds</button>}
   {can('wallet.read')&&<button className="secondary-action" onClick={()=>openView('history')}>Wallet History</button>}
  </div>
  {view!=='funding'&&warning}
  {refreshError&&<section className="notice" role="alert"><p>{refreshError}</p><button className="secondary-action" onClick={()=>void Promise.resolve(onChanged()).catch(()=>{})}>Refresh student details</button></section>}
  <dl className="detail-list">
   <div><dt>Student Year</dt><dd>{student.year_group?`Y${student.year_group}`:'Not assigned'}</dd></div>
   <div><dt>Academic year</dt><dd>{student.academic_year??'Not assigned'}</dd></div>
   {can('wallet.read')&&<div><dt>Wallet balance</dt><dd className="money">{student.balance_won===null?'Unavailable':formatWon(student.balance_won)}</dd></div>}
   <div><dt>Account</dt><dd>{student.active?'Active':'Inactive'}</dd></div>
   <div><dt>Card readiness</dt><dd>{student.card_active?'Card issued':'No active card'}</dd></div>
   <div><dt>PIN readiness</dt><dd>{student.pin_set===false?'PIN setup incomplete':student.pin_locked_until?`Locked until ${formatBusinessTime(student.pin_locked_until)} KST`:'PIN set'}</dd></div>
   <div><dt>Registered</dt><dd>{businessDate(new Date(student.created_at))}</dd></div>
  </dl>
  {!student.active&&<p className="notice">This account is inactive. Funding and spending cannot proceed.</p>}
  {student.card_active&&student.pin_set===false&&<p className="notice">Card issued, but initial PIN setup is incomplete. Reset PIN cannot be used for first issuance.</p>}

  {((can('students.enroll')&&student.active&&student.pin_set===false&&!student.card_active)||can('students.status.manage')||(student.pin_set!==false&&(can('credentials.reset')||can('credentials.card.replace'))))&&<details className="record-more"><summary>More student actions</summary><div className="action-row">
   {can('students.enroll')&&student.active&&student.pin_set===false&&!student.card_active&&<Link className="secondary-action" href={`/students/${student.student_id}/complete`}>Complete enrollment</Link>}
   {student.pin_set!==false&&can('credentials.reset')&&<Link className="secondary-action" href={`/security?studentId=${student.student_id}&purpose=RESET_STUDENT_PIN`}>Reset PIN</Link>}
   {student.pin_set!==false&&can('credentials.card.replace')&&<Link className="secondary-action" href={`/security?studentId=${student.student_id}&purpose=RESET_STUDENT_CARD`}>Replace Card</Link>}
   {can('students.status.manage')&&<button className="secondary-action" onClick={()=>openView('status')}>Manage Status</button>}
  </div></details>}
  {view==='funding'&&can('wallet.fund')&&<Dialog title={`Add Funds · ${student.display_name}`} onClose={()=>requestLeave(()=>setView(null))}><FundingScreen enabled={fundingEnabled} permissions={permissions} student={student} onPosted={onChanged} onLeaveStateChange={setChildState}/>{warning}</Dialog>}
  {view==='history'&&can('wallet.read')&&<WalletHistory student={student} onClose={()=>setView(null)}/>}
  {view==='status'&&can('students.status.manage')&&<><button className="secondary-action" onClick={()=>requestLeave(()=>setView(null))}>Back to student account</button><RecordManager kind="STUDENT" userId={userId} targetId={student.student_id} onChanged={onChanged} onLeaveStateChange={setChildState}/></>}
 </section>
 {leaveAction&&<ConfirmationDialog title="Discard unsaved student changes?" description="Only this unsubmitted draft will be discarded. No financial operation will be cancelled or repeated." confirmLabel="Discard draft" cancelLabel="Keep editing" destructive onCancel={()=>setLeaveAction(null)} onConfirm={async()=>{const action=leaveAction;setLeaveAction(null);setLeaveError('');action()}}/>}
 </Dialog>
}
