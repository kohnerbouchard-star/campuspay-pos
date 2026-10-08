'use client'
import { useEffect,useState } from 'react'
import { apiFetch } from '@/lib/api/client'
import type { StudentWalletSummary } from '@/features/wallets/domain'
import { Dialog } from '@/components/ui/Dialog'
import { EmptyState,ErrorState,LoadingState } from '@/components/ui/Feedback'
import { Money } from '@/components/ui/Money'
import { formatBusinessTime } from '@/lib/format/business-time'
import { WalletHistoryPageSchema,emptyHistoryFilters,historyParams,type HistoryFilters,type WalletHistoryPage } from '@/features/history/domain'
import { HistoryControls,HistoryPages } from '@/features/history/ui/HistoryControls'
export function WalletHistory({student,onClose}:{student:Pick<StudentWalletSummary,'student_id'|'student_code'|'display_name'>;onClose():void}){
 const [filters,setFilters]=useState<HistoryFilters>({...emptyHistoryFilters}),[data,setData]=useState<WalletHistoryPage|null>(null)
 const [error,setError]=useState(''),[loading,setLoading]=useState(true),[revision,setRevision]=useState(0)
 const url=`/api/accounting/students/${student.student_id}/history`
 useEffect(()=>{let current=true
  void apiFetch<unknown>(`${url}?${historyParams(filters)}`).then(value=>{if(current){setData(WalletHistoryPageSchema.parse(value));setError('')}})
   .catch(e=>{if(current)setError(e instanceof Error?e.message:'History could not load')}).finally(()=>{if(current)setLoading(false)})
  return()=>{current=false}
 },[url,filters,revision])
 function apply(v:HistoryFilters){setLoading(true);setFilters(v)}
 return <Dialog title={`${student.display_name} · Wallet history`} onClose={onClose}>
 <p>{student.student_code} · Current wallet balance {data?.balance_won==null?'unavailable':<strong><Money amount={data.balance_won}/></strong>}</p>
 <HistoryControls busy={loading} onApply={apply}/>
 {loading?<LoadingState label="Loading wallet history…"/>:error?<ErrorState message={error} onRetry={()=>{setLoading(true);setRevision(n=>n+1)}}/>:data&&<>
 <p>{data.from===null?'All history':`${data.from} through ${data.to} (Korea)`}{data.query?` · search: ${data.query}`:''}. {data.total} matching entries; net movement <Money amount={data.net_amount_won}/>. Totals cover the full filter, not this page.</p>
 <a className="secondary-action" href={`${url}/export?${historyParams({...filters,offset:0})}`}>Export all matching wallet entries</a>
 <p className="muted">Exports use one database snapshot. More than 50,000 matching records requires a narrower date or search filter; no rows are silently omitted.</p>
 {data.reconciliation_difference_won!==null&&data.reconciliation_difference_won!==0&&<p role="alert" className="error-message">Current wallet differs from its all-time ledger by <Money amount={data.reconciliation_difference_won}/>. Review the opening balance or missing records; do not invent an adjustment.</p>}
 {data.rows.length===0?<EmptyState title="No matching wallet entries">No journal records match this filter. This does not establish the account’s opening balance.</EmptyState>:<div className="table-scroll" role="region" tabIndex={0} aria-label="Wallet transactions"><table>
 <caption>Paginated wallet history · Korea Standard Time</caption><thead><tr><th>Reference / purpose</th><th className="numeric">Amount</th><th className="numeric">Balance after</th></tr></thead><tbody>{data.rows.map(row=><tr key={row.ledger_id}>
 <td><strong>{row.reference_number}</strong><small>{row.reason_code.toLowerCase().replaceAll('_',' ')}</small><small>{formatBusinessTime(row.created_at)}</small><small>{row.actor_name}</small>{row.notes&&<small>{row.notes}</small>}</td><td className="numeric"><Money amount={row.amount_won}/></td><td className="numeric"><Money amount={row.balance_after_won}/></td></tr>)}</tbody></table></div>}
 <HistoryPages offset={data.offset} total={data.total} length={data.rows.length} busy={loading} onPage={offset=>apply({...filters,offset})}/>
 <p className="muted">Current balance is all-time, not the filtered closing balance. History navigation is live; use an export for a single-snapshot record.</p>
 </>}
 </Dialog>
}
