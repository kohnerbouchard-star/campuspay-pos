'use client'

import { useState } from 'react'
import { getRosterStudents } from '@/features/students/client'
import type { EnrollmentResult, ManagedStudent } from '@/features/students/domain'
import { EnrollmentForm } from '@/features/students/ui/EnrollmentForm'
import { StudentDirectory } from '@/features/students/ui/StudentDirectory'
import { StudentDetail } from '@/features/students/ui/StudentDetail'
import { EnrollmentSuccess } from '@/features/students/ui/EnrollmentSuccess'
import { formatWon } from '@/lib/format/currency'

export function StudentsScreen({userId}:{userId:string}) {
  const [enrolling, setEnrolling] = useState(false)
  const [student, setStudent] = useState<ManagedStudent | null>(null)
  const [result, setResult] = useState<EnrollmentResult | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)
  async function refreshSelected() {
    setRefreshKey(n=>n+1)
    if(!student)return
    const selectedId=student.student_id
    try{const rows=await getRosterStudents(student.student_code,null,0);setStudent(current=>current?.student_id===selectedId?(rows.find(row=>row.student_id===selectedId)??null):current)}
    catch{setStudent(current=>current?.student_id===selectedId?null:current)}
  }
  function startEnrollment() { setStudent(null); setResult(null); setEnrolling(true) }

  return <main className="workspace">
    <header className="workspace-header"><div><p className="eyebrow">MICA Money · E202</p><h1>Students</h1><p className="muted">Enroll students, review their accounts, and manage card access.</p></div>
      <button className="primary-action" disabled={enrolling} onClick={startEnrollment}>+ Enroll student</button>
    </header>
    <div className="dashboard-grid">
      {enrolling ? <section className="panel"><p className="eyebrow">New account</p><h2>Ready for the student</h2><ol className="workflow-steps"><li>Check the student’s ID and name.</li><li>Scan an unused MICA Money Card.</li><li>Let the student enter and confirm their PIN.</li><li>Create the account and hand over the card.</li></ol><p className="muted">The new wallet starts at {formatWon(0)}. The student can sign in to the online store immediately.</p></section> :
        <StudentDirectory selectedId={student?.student_id} refreshKey={refreshKey} onSelect={(value) => { setStudent(value); setResult(null) }} />}
      {enrolling ? <EnrollmentForm onCancel={() => setEnrolling(false)} onComplete={(value) => { setResult(value); setStudent(null); setEnrolling(false); setRefreshKey((key) => key + 1) }} /> :
        result ? <EnrollmentSuccess result={result} onDone={() => setResult(null)} onAnother={startEnrollment} /> :
          student ? <StudentDetail key={student.student_id} student={student} userId={userId} onChanged={()=>void refreshSelected()} /> :
            <section className="panel empty-state"><h2>Select a student</h2><p className="muted">Review a student’s wallet and card status, or enroll a new student at E202.</p></section>}
    </div>
  </main>
}
