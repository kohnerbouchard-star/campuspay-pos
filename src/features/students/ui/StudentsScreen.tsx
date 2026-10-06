'use client'

import type { Permission } from '@/features/auth/domain'
import { useRef, useState } from 'react'
import { getRosterStudents } from '@/features/students/client'
import type { EnrollmentResult, ManagedStudent } from '@/features/students/domain'
import { EnrollmentForm } from '@/features/students/ui/EnrollmentForm'
import { StudentDirectory } from '@/features/students/ui/StudentDirectory'
import { StudentDetail } from '@/features/students/ui/StudentDetail'
import { EnrollmentSuccess } from '@/features/students/ui/EnrollmentSuccess'
import { formatWon } from '@/lib/format/currency'

export function StudentsScreen({userId,permissions,fundingEnabled}:{userId:string;permissions:readonly Permission[];fundingEnabled:boolean}) {
  const [enrolling, setEnrolling] = useState(false)
  const [student, setStudent] = useState<ManagedStudent | null>(null)
  const [result, setResult] = useState<EnrollmentResult | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)
  const [refreshError, setRefreshError] = useState('')
  const refreshGeneration = useRef(0)
  async function refreshSelected() {
    const generation=++refreshGeneration.current
    setRefreshError('')
    setRefreshKey(n=>n+1)
    if(!student)return
    const selectedId=student.student_id
    try{
      const rows=await getRosterStudents(student.student_code,null,0)
      const refreshed=rows.find(row=>row.student_id===selectedId)
      if(!refreshed)throw new Error('Selected student was not returned')
      if(generation===refreshGeneration.current)setStudent(current=>current?.student_id===selectedId?refreshed:current)
    }catch(error){
      if(generation===refreshGeneration.current)setRefreshError('The change is confirmed, but the student details could not refresh. The displayed details may be out of date. Your action receipt remains below.')
      throw error
    }
  }
  function startEnrollment() { refreshGeneration.current++;setRefreshError('');setStudent(null); setResult(null); setEnrolling(true) }

  return <main className="workspace">
    <header className="workspace-header"><div><p className="eyebrow">MICA Money · E202</p><h1>Students</h1><p className="muted">Find a student and use the account actions assigned to you.</p></div>
      {permissions.includes('students.enroll')&&<button className="primary-action" disabled={enrolling} onClick={startEnrollment}>+ Enroll student</button>}
    </header>
    {refreshError&&!student&&<section className="notice" role="alert"><p>{refreshError}</p><button className="secondary-action" onClick={()=>void refreshSelected().catch(()=>{})}>Refresh student details</button></section>}
    <div className={enrolling?"dashboard-grid":"students-directory-layout"}>
      {enrolling ? <section className="panel"><p className="eyebrow">New account</p><h2>Ready for the student</h2><ol className="workflow-steps"><li>Check the student’s ID and name.</li><li>Scan an unused MICA Money Card.</li><li>Let the student enter and confirm their PIN.</li><li>Create the account and hand over the card.</li></ol><p className="muted">The new wallet starts at {formatWon(0)}. The student can sign in to the online store immediately.</p></section> :
        <StudentDirectory canViewWallet={permissions.includes('wallet.read')} selectedId={student?.student_id} refreshKey={refreshKey} onSelect={(value) => { refreshGeneration.current++;setRefreshError('');setStudent(value); setResult(null) }} />}
      {enrolling ? <EnrollmentForm onCancel={() => setEnrolling(false)} onComplete={(value) => { setResult(value); setStudent(null); setEnrolling(false); setRefreshKey((key) => key + 1) }} /> :
        result ? <EnrollmentSuccess result={result} onDone={() => setResult(null)} onAnother={startEnrollment} /> :
          student ? <StudentDetail key={student.student_id} student={student} userId={userId} permissions={permissions} fundingEnabled={fundingEnabled} refreshError={refreshError} onClose={()=>{refreshGeneration.current++;setRefreshError('');setStudent(null)}} onChanged={refreshSelected} /> :
            <section className="panel empty-state"><h2>Select a student</h2><p className="muted">Review a student’s wallet and card status, or enroll a new student at E202.</p></section>}
    </div>
  </main>
}
