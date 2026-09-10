'use client'

import { useEffect, useRef } from 'react'
import type { EnrollmentResult } from '@/features/students/domain'
import { formatWon } from '@/lib/format/currency'

export function EnrollmentSuccess({ result, onDone, onAnother }: {
  result: EnrollmentResult
  onDone(): void
  onAnother(): void
}) {
  const heading = useRef<HTMLHeadingElement>(null)
  useEffect(() => { heading.current?.focus() }, [])
  return <section className="panel" aria-labelledby="enrollment-success-heading">
    <p className="eyebrow">Enrollment complete</p>
    <h2 id="enrollment-success-heading" ref={heading} tabIndex={-1}>MICA Money account created</h2>
    <dl className="detail-list">
      <div><dt>Student</dt><dd>{result.display_name}</dd></div>
      <div><dt>Student ID</dt><dd>{result.student_code}</dd></div>
      <div><dt>Card</dt><dd>Active</dd></div>
      <div><dt>Wallet</dt><dd className="money">{formatWon(result.balance_won)}</dd></div>
    </dl>
    <p>The student can now sign in to the online store.</p>
    <p className="muted">Enrollment receipt: {result.audit_reference}</p>
    <div className="action-row">
      <button className="secondary-action" onClick={onDone}>Done</button>
      <button className="primary-action" onClick={onAnother}>Enroll another student</button>
    </div>
  </section>
}
