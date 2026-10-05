'use client'
import { useState } from 'react'
import Link from 'next/link'
import type { Permission } from '@/features/auth/domain'
import { RecordManager } from '@/features/management/RecordManager'
import { Dialog } from '@/components/ui/Dialog'
import { FundingScreen } from '@/features/funding/ui/FundingScreen'
import { WalletHistory } from '@/features/wallets/ui/WalletHistory'
import { businessDate, formatBusinessTime } from '@/lib/format/business-time'
import type { ManagedStudent } from '@/features/students/domain'
import { formatWon } from '@/lib/format/currency'
export function StudentDetail({student,userId,permissions,fundingEnabled,onChanged}:{student:ManagedStudent;userId:string;permissions:readonly Permission[];fundingEnabled:boolean;onChanged():void|Promise<void>}) {
 const [view,setView]=useState<'funding'|'history'|'status'|null>(null)
 const can=(p:Permission)=>permissions.includes(p)
 return <section className="panel" aria-labelledby="student-detail-heading">
  <p className="eyebrow">Student account</p><h2 id="student-detail-heading">{student.display_name}</h2>
  <p className="muted">{student.student_code}{student.year_group?` · Y${student.year_group}`:''}</p>
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
  <div className="action-row">
   {can('wallet.fund')&&<button className="primary-action" onClick={()=>setView('funding')}>Add Funds</button>}
   {can('wallet.read')&&<button className="secondary-action" onClick={()=>setView('history')}>Wallet History</button>}
  </div>
  {(can('students.enroll')||can('students.status.manage')||can('credentials.reset')||can('credentials.card.replace'))&&<details className="record-more"><summary>More student actions</summary><div className="action-row">
   {can('students.enroll')&&student.active&&student.pin_set===false&&!student.card_active&&<Link className="secondary-action" href={`/students/${student.student_id}/complete`}>Complete enrollment</Link>}
   {student.pin_set!==false&&can('credentials.reset')&&<Link className="secondary-action" href={`/security?studentId=${student.student_id}&purpose=RESET_STUDENT_PIN`}>Reset PIN</Link>}
   {student.pin_set!==false&&can('credentials.card.replace')&&<Link className="secondary-action" href={`/security?studentId=${student.student_id}&purpose=RESET_STUDENT_CARD`}>Replace Card</Link>}
   {can('students.status.manage')&&<button className="secondary-action" onClick={()=>setView('status')}>Manage Status</button>}
  </div></details>}
  {view==='funding'&&can('wallet.fund')&&<Dialog title={`Add Funds · ${student.display_name}`} onClose={()=>setView(null)}><FundingScreen enabled={fundingEnabled} permissions={permissions} student={student} onPosted={onChanged}/></Dialog>}
  {view==='history'&&can('wallet.read')&&<WalletHistory student={student} onClose={()=>setView(null)}/>}
  {view==='status'&&can('students.status.manage')&&<RecordManager kind="STUDENT" userId={userId} targetId={student.student_id} onChanged={onChanged}/>}
 </section>
}
