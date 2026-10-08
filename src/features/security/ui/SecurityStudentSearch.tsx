'use client'

import { useEffect, useState } from 'react'
import { searchSecurityStudents } from '@/features/security/client'
import type { SecurityStudent } from '@/features/security/domain'

export function SecurityStudentSearch({ onSelect, selectedId, disabled }: {
  onSelect(student: SecurityStudent): void
  selectedId?: string
  disabled: boolean
}) {
  const [query, setQuery] = useState('')
  const [rows, setRows] = useState<SecurityStudent[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [retry, setRetry] = useState(0)
  useEffect(() => {
    let current = true
    const timer = setTimeout(() => {
      setLoading(true)
      setError(null)
      void searchSecurityStudents(query).then((data) => { if (current) setRows(data) })
        .catch((cause) => { if (current) setError(cause instanceof Error ? cause.message : 'Students could not be loaded.') })
        .finally(() => { if (current) setLoading(false) })
    }, 200)
    return () => { current = false; clearTimeout(timer) }
  }, [query, retry])
  return <section className="panel table-panel" aria-labelledby="security-students-heading" aria-busy={loading}>
    <div className="panel-heading"><div><p className="eyebrow">Find an account</p><h2 id="security-students-heading">Students</h2></div></div>
    <label className="field"><span>Search students</span><input id="security-student-search" type="search" maxLength={120} placeholder="Student name or ID" value={query} disabled={disabled} onChange={(event) => setQuery(event.target.value)} /></label>
    {error ? <div role="alert" className="error-message">{error}<button className="secondary-action" onClick={() => setRetry((value) => value + 1)}>Retry</button></div> :
      <div className="table-scroll"><table><thead><tr><th scope="col">Student</th><th scope="col">Card</th></tr></thead><tbody>
        {loading ? <tr><td colSpan={2} role="status">Loading students…</td></tr> : rows.length ? rows.map((student) => <tr key={student.student_id} className={student.student_id === selectedId ? 'selected-row' : undefined}><td><button id={`security-student-${student.student_id}`} className="table-link" aria-pressed={student.student_id === selectedId} disabled={disabled} onClick={() => onSelect(student)}><strong>{student.display_name}</strong><small>{student.student_code}</small></button></td><td>{student.card_active ? 'Active' : 'No active card'}</td></tr>) : <tr><td colSpan={2}>No students found. Try a different name or ID.</td></tr>}
      </tbody></table></div>}
    {!loading && rows.length === 50 && <p className="muted">Showing the first 50 matches. Refine your search to find a student.</p>}
  </section>
}
