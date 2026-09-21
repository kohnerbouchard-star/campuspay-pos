'use client'
import { useEffect, useState } from 'react'
import { searchWallets } from '@/features/wallets/client'
import type { StudentWalletSummary } from '@/features/wallets/domain'
import { Money } from '@/components/ui/Money'
import { ErrorState, LoadingState, EmptyState } from '@/components/ui/Feedback'
import { WalletHistory } from '@/features/wallets/ui/WalletHistory'
export function WalletSearch({ onSelect }: { onSelect?(student: StudentWalletSummary): void }) {
  const [query, setQuery] = useState('')
  const [rows, setRows] = useState<StudentWalletSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<StudentWalletSummary | null>(null)
  const [revision, setRevision] = useState(0)
  useEffect(() => {
    let active = true
    const timer = setTimeout(() => { void searchWallets(query).then(data => { if (active) { setRows(data); setError(null) } }).catch((e: unknown) => { if (active) setError(e instanceof Error ? e.message : 'Wallets could not be loaded.') }).finally(() => { if (active) setLoading(false) }) }, 250)
    return () => { active = false; clearTimeout(timer) }
  }, [query, revision])
  return <section className="panel table-panel"><div className="panel-heading"><div><p className="eyebrow">Student accounts</p><h2>Wallet balances</h2></div><label className="field"><span>Search name or student ID</span><input className="search-input" type="search" value={query} onChange={e => { setLoading(true); setQuery(e.target.value) }} /></label></div>
    {loading ? <LoadingState label="Finding student wallets…" /> : error ? <ErrorState message={error} onRetry={() => { setLoading(true); setRevision(value => value + 1) }} /> : rows.length === 0 ? <EmptyState title="No students found">Try a different name or student ID.</EmptyState> : <div className="table-scroll" role="region" tabIndex={0} aria-label="Student wallets"><table><thead><tr><th>Student</th><th className="numeric">Balance</th><th className="numeric">Debt</th><th>Card</th><th><span className="sr-only">Actions</span></th></tr></thead><tbody>{rows.map(row => <tr key={row.student_id}><td><strong>{row.display_name}</strong><small>{row.student_code}</small></td><td className="numeric"><Money amount={row.balance_won} /></td><td className="numeric"><Money amount={row.debt_won} /></td><td><span className="status-pill">{row.card_active ? 'Active' : 'No active card'}</span></td><td><button className="table-action" onClick={() => onSelect ? onSelect(row) : setSelected(row)}>{onSelect ? 'Select student' : 'View history'}</button></td></tr>)}</tbody></table></div>}
    {selected && <WalletHistory key={selected.student_id} student={selected} onClose={() => setSelected(null)} />}
  </section>
}
