'use client'

import { useEffect, useState } from 'react'
import { getRosterStudents } from '@/features/students/client'
import type { ManagedStudent } from '@/features/students/domain'
import { formatWon } from '@/lib/format/currency'

export function StudentDirectory({ onSelect, selectedId, refreshKey, canViewWallet }: {
  onSelect(student: ManagedStudent): void
  selectedId?: string
  refreshKey: number
  canViewWallet: boolean
}) {
  const [query, setQuery] = useState('')
  const [yearGroup, setYearGroup] = useState<number | null>(null)
  const [offset, setOffset] = useState(0)
  const [rows, setRows] = useState<ManagedStudent[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [retry, setRetry] = useState(0)
  useEffect(() => {
    let current = true
    const timeout = setTimeout(() => {
      setLoading(true)
      setError(null)
      void getRosterStudents(query, yearGroup, offset).then((data) => { if (current) setRows(data) })
        .catch((cause) => { if (current) setError(cause instanceof Error ? cause.message : 'Students could not be loaded.') })
        .finally(() => { if (current) setLoading(false) })
    }, 200)
    return () => { current = false; clearTimeout(timeout) }
  }, [query, yearGroup, offset, refreshKey, retry])
  const total = rows[0]?.total_count ?? 0

  return <section className="panel table-panel" aria-labelledby="student-directory-heading" aria-busy={loading}>
    <div className="panel-heading"><div><p className="eyebrow">MICA Money accounts</p><h2 id="student-directory-heading">Student directory</h2></div></div>
    <label className="field"><span>Search students</span><input type="search" placeholder="Student name or ID" maxLength={120} value={query} onChange={(event) => { setQuery(event.target.value); setOffset(0) }} /></label>
    <label className="field"><span>Student Year</span><select value={yearGroup ?? ''} onChange={(event) => { setYearGroup(event.target.value === '' ? null : Number(event.target.value)); setOffset(0) }}>
      <option value="">All years</option>{Array.from({ length: 13 }, (_, index) => index + 1).map(year => <option value={year} key={year}>Y{year}</option>)}
    </select></label>
    {error ? <div role="alert" className="error-message">{error}<button className="secondary-action" onClick={() => setRetry((value) => value + 1)}>Retry</button></div> :
      <div className="table-scroll"><table><thead><tr><th scope="col">Student</th><th scope="col">Year</th>{canViewWallet&&<th scope="col">Wallet</th>}<th scope="col">Access</th></tr></thead>
        <tbody>{loading ? <tr><td colSpan={canViewWallet?4:3} role="status">Loading students…</td></tr> : rows.length ? rows.map((student) => <tr key={student.student_id} className={selectedId === student.student_id ? 'selected-row' : undefined}>
          <td><button className="table-link" aria-pressed={selectedId === student.student_id} onClick={() => onSelect(student)}><strong>{student.display_name}</strong><small>{student.student_code}</small></button></td>
          <td>{student.year_group ? `Y${student.year_group}` : 'Unassigned'}</td>
          {canViewWallet&&<td className="money">{student.balance_won===null?'Unavailable':formatWon(student.balance_won)}</td>}<td><span className="status-pill">{!student.active ? 'Inactive' : !student.card_active ? 'No card issued' : student.pin_set === false ? 'PIN not set' : 'Active'}</span></td>
        </tr>) : <tr><td colSpan={canViewWallet?4:3}>No students found on this page. Try a different year, name, or ID.</td></tr>}</tbody>
      </table></div>}
    <div className="action-row" aria-label="Student directory pages">
      <button className="secondary-action" disabled={loading || offset === 0} onClick={() => setOffset(value => Math.max(0, value - 50))}>Previous</button>
      <span role="status">{loading ? 'Loading…' : error ? 'Search unavailable' : rows.length ? `${offset + 1}–${offset + rows.length} of ${total}` : 'No matches on this page'}</span>
      <button className="secondary-action" disabled={loading || !!error || rows.length === 0 || offset + rows.length >= total} onClick={() => setOffset(value => value + 50)}>Next</button>
    </div>
    <p className="muted">Year identifies the current year group. Student IDs stay unchanged when students advance. A roster entry does not issue a card or PIN.</p>
  </section>
}
