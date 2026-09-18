import { businessDate, formatBusinessTime } from '@/lib/format/business-time'
import Link from 'next/link'
import type { ManagedStudent } from '@/features/students/domain'
import { formatWon } from '@/lib/format/currency'

export function StudentDetail({ student }: { student: ManagedStudent }) {
  return <section className="panel" aria-labelledby="student-detail-heading">
    <p className="eyebrow">Student account</p>
    <h2 id="student-detail-heading">{student.display_name}</h2>
    <p className="muted">{student.student_code}{student.year_group ? ` · Y${student.year_group}` : ''}</p>
    <dl className="detail-list">
      <div><dt>Student Year</dt><dd>{student.year_group ? `Y${student.year_group}` : 'Not assigned'}</dd></div>
      <div><dt>Academic year</dt><dd>{student.academic_year ?? 'Not assigned'}</dd></div>
      <div><dt>Wallet balance</dt><dd className="money">{formatWon(student.balance_won)}</dd></div>
      <div><dt>Account</dt><dd>{student.active ? 'Active roster entry' : 'Inactive'}</dd></div>
      <div><dt>MICA Money Card</dt><dd>{student.card_active ? 'Active' : 'No active card'}</dd></div>
      <div><dt>PIN access</dt><dd>{student.pin_set === false ? 'Not set — roster only' : student.pin_locked_until ? `Temporarily locked until ${formatBusinessTime(student.pin_locked_until)} KST` : 'Available'}</dd></div>
      <div><dt>Registered</dt><dd>{businessDate(new Date(student.created_at))}</dd></div>
    </dl>
    {student.audit_reference && <p className="muted">Enrollment receipt: {student.audit_reference}</p>}
    <div className="action-row">
      {student.active && student.pin_set !== false && <Link className="secondary-action" href={`/security?studentId=${student.student_id}`}>Reset PIN or replace card</Link>}
      <Link className="secondary-action" href="/accounting">Open Accounting</Link>
    </div>
    <p className="muted">{student.pin_set === false ? 'This student is registered without a PIN. Card and PIN issuance is a separate, authorized enrollment step; do not create a duplicate student account.' : 'PIN resets and replacement cards require a fresh Super Admin authorization.'}</p>
  </section>
