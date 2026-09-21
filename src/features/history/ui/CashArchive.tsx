'use client'
import { useEffect,useState } from 'react'
import { apiFetch } from '@/lib/api/client'
import { formatWon } from '@/lib/format/currency'
import { formatBusinessTime } from '@/lib/format/business-time'
import { ErrorState,LoadingState } from '@/components/ui/Feedback'
import { CashHistoryPageSchema,emptyHistoryFilters,historyParams,type CashHistoryPage,type HistoryFilters } from '../domain'
import { HistoryControls,HistoryPages } from './HistoryControls'
export function CashArchive(){
 const [filters,setFilters]=useState<HistoryFilters>({...emptyHistoryFilters}),[data,setData]=useState<CashHistoryPage|null>(null)
 const [loading,setLoading]=useState(true),[error,setError]=useState(''),[revision,setRevision]=useState(0),[selected,setSelected]=useState<string|null>(null)
 useEffect(()=>{let current=true
  void apiFetch<unknown>(`/api/cash/history?${historyParams(filters)}`).then(v=>{if(current){setData(CashHistoryPageSchema.parse(v));setError('')}})
   .catch(e=>{if(current)setError(e instanceof Error?e.message:'Cash history could not load')}).finally(()=>{if(current)setLoading(false)})
  return()=>{current=false}
 },[filters,revision])
 function apply(v:HistoryFilters){setLoading(true);setSelected(null);setFilters(v)}
 const detail=data?.rows.find(r=>r.shift.shift_id===selected)
 return <main className="workspace"><header className="workspace-header"><div><p className="eyebrow">Accounting history</p><h1>Complete cash-close history</h1><p>Filter and export recorded drawer closes across every history page.</p></div><a className="secondary-action" href="/cash">Current drawer and variance review</a></header>
 <section className="panel form-stack"><HistoryControls busy={loading} onApply={apply}/></section>
 {loading?<LoadingState label="Loading cash-close history…"/>:error?<ErrorState message={error} onRetry={()=>{setLoading(true);setRevision(n=>n+1)}}/>:data&&<>
 <section className="panel form-stack"><h2>Matching closed shifts</h2><p>{data.scope==='ALL_TERMINALS'?'All authorized terminals':'Only your current terminal'} · {data.from===null?'all history':`${data.from} through ${data.to} (Korea)`}{data.query?` · search: ${data.query}`:''}.</p>
 <p>{data.total} closes · expected {formatWon(data.expected_won)} · counted {formatWon(data.counted_won)} · total variance {formatWon(data.variance_won)}. These totals cover the full filter, not this page.</p>
 {data.unreviewed>0&&<p className="error-message" role="alert">{data.unreviewed} count variances still need independent review.</p>}
 <a className="secondary-action" href={`/api/cash/history/export?${historyParams({...filters,offset:0})}`}>Export all matching cash closes</a><p className="muted">One-snapshot CSV, including funding movements and review notes. More than 50,000 rows requires a narrower filter; it never returns a partial file.</p>
 <div className="table-scroll" role="region" tabIndex={0} aria-label="Complete cash-close register"><table><thead><tr><th>Closed (Korea)</th><th>Terminal / operator</th><th>Expected</th><th>Counted</th><th>Variance</th><th>Details</th></tr></thead><tbody>{data.rows.map(({shift:r,closed_by_name})=><tr key={r.shift_id}>
 <td>{formatBusinessTime(r.closed_at!)}<small>{r.shift_id}</small></td><td>{r.terminal_label??r.terminal_id}<small>{closed_by_name}</small></td><td>{formatWon(r.expected_won)}</td><td>{formatWon(r.counted_won??0)}</td><td>{formatWon(r.variance_won??0)}</td><td><button onClick={()=>setSelected(r.shift_id)}>View close details</button></td></tr>)}</tbody></table></div>
 {!data.rows.length&&<p>No matching closed shifts.</p>}<HistoryPages offset={data.offset} total={data.total} length={data.rows.length} busy={loading} onPage={offset=>apply({...filters,offset})}/>
 <p className="muted">Dates apply to closing time. A shift may contain movements from more than one day; these totals are not the daily sales report.</p>
 </section>
 {detail&&<section className="panel form-stack" aria-label="Cash close details"><h2>Close {detail.shift.shift_id}</h2><p>Opened by {detail.opened_by_name}; closed by {detail.closed_by_name}.</p>
 <p>Opening float {formatWon(detail.shift.opening_float_won)} + sales {formatWon(detail.shift.cash_sales_won)} − refund payouts {formatWon(detail.shift.cash_payouts_won)} + funding/manual in {formatWon(detail.shift.funding_in_won)} − funding/manual out {formatWon(detail.shift.funding_out_won)} = expected {formatWon(detail.shift.expected_won)}.</p>
 <p>Counted {formatWon(detail.shift.counted_won??0)}; variance {formatWon(detail.shift.variance_won??0)}.</p><p>{detail.shift.close_notes}</p><p>Independent review: {detail.approved_by_name??'Not recorded'}{detail.shift.approval_notes?` · ${detail.shift.approval_notes}`:''}</p></section>}
 </>}
 </main>
}
