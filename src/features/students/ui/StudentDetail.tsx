'use client'
import { useState } from 'react'
import { RecordRemovalButton } from '@/features/removal/RecordRemoval'
import { RecordManager } from '@/features/management/RecordManager'
import { businessDate, formatBusinessTime } from '@/lib/format/business-time'
import Link from 'next/link'
import type { ManagedStudent } from '@/features/students/domain'
import { formatWon } from '@/lib/format/currency'

export function StudentDetail({ student,userId,onChanged }: { student: ManagedStudent;userId:string;onChanged():void|Promise<void> }) {
  const [managing,setManaging]=useState(false)
  return <section className="panel" aria-labelledby="student-detail-heading">
    <p className="eyebrow">Student account</p>
    <h2 id="student-detail-heading">{student.display_name}</h2>
    <p className="muted">{student.student_code}{student.year_group ? ` · Y${student.year_group}` : ''}</p>
    <dl className="detail-list">
      <div><dt>Student Year</dt><dd>{student.year_group ? `Y${student.year_group}` : 'Not assigned'}</dd></div>
      <div><dt>Academic year</dt><dd>{student.academic_year ?? 'Not assigned'}</dd></div>
      <div><dt>Wallet balance</dt><dd className="money">{formatWon(student.balance_won)}</dd></div>
      <div><dt>Account</dt><dd>{student.active ? 'Active roster entry' : 'Inactive'}</dd></div>
      <div><dt>MICA Money Card</dt><dd>{student.card_active ? (student.active ? 'Active' : 'Assigned — account inactive') : 'No active card'}</dd></div>
      <div><dt>PIN access</dt><dd>{!student.active ? 'Spending and store sign-in disabled' : student.pin_set === false ? (student.card_active ? 'Card issued — PIN setup incomplete' : 'Not set — roster only') : student.pin_locked_until ? `Temporarily locked until ${formatBusinessTime(student.pin_locked_until)} KST` : 'Available'}</dd></div>
      <div><dt>Registered</dt><dd>{businessDate(new Date(student.created_at))}</dd></div>
    </dl>
    {student.audit_reference && <p className="muted">Enrollment receipt: {student.audit_reference}</p>}
    <div className="action-row">
      {student.active && student.pin_set === false && !student.card_active && <Link className="secondary-action" href={`/students/${student.student_id}/complete`}>Complete enrollment</Link>}
      {student.active && student.pin_set !== false && <Link className="secondary-action" href={`/security?studentId=${student.student_id}`}>Reset PIN or replace card</Link>}
      <button className="secondary-action" aria-expanded={managing} onClick={()=>setManaging(!managing)}>Manage student status</button>
      <RecordRemovalButton kind="STUDENT" targetId={student.student_id}/>
      <Link className="secondary-action" href="/accounting">Open Accounting</Link>
    </div>
    {managing&&<RecordManager kind="STUDENT" userId={userId} targetId={student.student_id} onChanged={onChanged}/>}
    <p className="muted">{student.pin_set === false && student.card_active ? 'This account already has a card but no PIN. It needs authorized credential setup, not a duplicate enrollment. Reset PIN must not be used as first issuance.' : student.pin_set === false ? 'This student is registered without a PIN. Complete enrollment is a separate, authorized step and is disabled until enabled for this installation. Never create a duplicate student account.' : 'PIN resets and replacement cards require a fresh Super Admin authorization.'}</p>
  </section>
}
