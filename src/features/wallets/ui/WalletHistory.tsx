'use client'
import { useEffect, useState } from 'react'
import { apiFetch } from '@/lib/api/client'
import type { StudentWalletSummary, WalletTransaction } from '@/features/wallets/domain'
import { Dialog } from '@/components/ui/Dialog'
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/Feedback'
import { Money } from '@/components/ui/Money'
export function WalletHistory({ student, onClose }: { student: StudentWalletSummary; onClose(): void }) {
  const [rows, setRows] = useState<WalletTransaction[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [revision, setRevision] = useState(0)
  useEffect(() => {
    let active = true
    apiFetch<WalletTransaction[]>(`/api/accounting/students/${student.student_id}/transactions`).then(data => { if (active) { setRows(data); setError(null) } }).catch((e: unknown) => { if (active) setError(e instanceof Error ? e.message : 'History could not be loaded.') }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [student.student_id, revision])
  return <Dialog title={`${student.display_name} · Wallet history`} onClose={onClose}><p>{student.student_code} · Balance <strong><Money amount={student.balance_won} /></strong></p>{loading ? <LoadingState /> : error ? <ErrorState message={error} onRetry={() => { setLoading(true); setRevision(value => value + 1) }} /> : rows.length === 0 ? <EmptyState title="No wallet transactions yet">This account starts at ₩0.</EmptyState> : <div className="table-scroll" role="region" tabIndex={0} aria-label="Wallet transactions"><table><caption>Most recent 100 transactions · Korea Standard Time</caption><thead><tr><th>Reference / purpose</th><th className="numeric">Amount</th><th className="numeric">Balance after</th></tr></thead><tbody>{rows.map(row => <tr key={row.reference_number}><td><strong>{row.reference_number}</strong><small>{row.reason_code.toLowerCase().replaceAll('_', ' ')}</small><small>{new Date(row.created_at).toLocaleString('en-GB', { timeZone: 'Asia/Seoul' })}</small><small>{row.actor_name}</small>{row.notes && <small>{row.notes}</small>}</td><td className="numeric"><Money amount={row.amount_won} /></td><td className="numeric"><Money amount={row.balance_after_won} /></td></tr>)}</tbody></table></div>}</Dialog>
}
