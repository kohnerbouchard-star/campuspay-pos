'use client'

import { useEffect, useState } from 'react'
import { getStudents } from '@/features/students/client'
import type { ManagedStudent } from '@/features/students/domain'
import { formatWon } from '@/lib/format/currency'

export function StudentDirectory({ onSelect, selectedId, refreshKey }: {
  onSelect(student: ManagedStudent): void
  selectedId?: string
  refreshKey: number
}) {
  const [query, setQuery] = useState('')
  const [rows, setRows] = useState<ManagedStudent[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [retry, setRetry] = useState(0)
  useEffect(() => {
    let current = true
    const timeout = setTimeout(() => {
      setLoading(true)
      setError(null)
      void getStudents(query).then((data) => { if (current) setRows(data) })
        .catch((cause) => { if (current) setError(cause instanceof Error ? cause.message : 'Students could not be loaded.') })
        .finally(() => { if (current) setLoading(false) })
    }, 200)
    return () => { current = false; clearTimeout(timeout) }
  }, [query, refreshKey, retry])

  return <section className="panel table-panel" aria-labelledby="student-directory-heading" aria-busy={loading}>
    <div className="panel-heading"><div><p className="eyebrow">MICA Money accounts</p><h2 id="student-directory-heading">Student directory</h2></div></div>
    <label className="field"><span>Search students</span><input type="search" placeholder="Student name or ID" maxLength={120} value={query} onChange={(event) => setQuery(event.target.value)} /></label>
    {error ? <div role="alert" className="error-message">{error}<button className="secondary-action" onClick={() => setRetry((value) => value + 1)}>Retry</button></div> :
      <div className="table-scroll"><table><thead><tr><th scope="col">Student</th><th scope="col">Wallet</th><th scope="col">Status</th></tr></thead>
        <tbody>{loading ? <tr><td colSpan={3} role="status">Loading students…</td></tr> : rows.length ? rows.map((student) => <tr key={student.student_id} className={selectedId === student.student_id ? 'selected-row' : undefined}>
          <td><button className="table-link" aria-pressed={selectedId === student.student_id} onClick={() => onSelect(student)}><strong>{student.display_name}</strong><small>{student.student_code}</small></button></td>
          <td className="money">{formatWon(student.balance_won)}</td><td><span className="status-pill">{student.active ? 'Active' : 'Inactive'}</span></td>
        </tr>) : <tr><td colSpan={3}>No students found. Try a different name or ID.</td></tr>}</tbody>
      </table></div>}
    {!loading && rows.length === 50 && <p className="muted">Showing the first 50 matches. Refine your search to find a student.</p>}
  </section>
}
