'use client'
import { useEffect,useState } from 'react'
import type { Permission } from '@/features/auth/domain'
import { REPORT_PERMISSIONS } from '@/features/auth/navigation'
import { apiFetch } from '@/lib/api/client'
import { businessDate,formatBusinessTime } from '@/lib/format/business-time'
import { Money } from '@/components/ui/Money'
import { ErrorState,LoadingState } from '@/components/ui/Feedback'
import { ReconciliationSchema,SCOPE_LABELS,SECTION_ORDER,type Reconciliation } from '../domain'
export function ReconciliationScreen({permissions=[]}:{permissions?:readonly Permission[]}){
 const [day,setDay]=useState(()=>businessDate()),[applied,setApplied]=useState(day),[data,setData]=useState<Reconciliation|null>(null),[loading,setLoading]=useState(true),[error,setError]=useState(''),[revision,setRevision]=useState(0)
 useEffect(()=>{let current=true
  void apiFetch<unknown>(`/api/reconciliation?day=${encodeURIComponent(applied)}`).then(value=>{if(current){setData(ReconciliationSchema.parse(value));setError('')}})
   .catch(e=>{if(current)setError(e instanceof Error?e.message:'Reconciliation could not be loaded')}).finally(()=>{if(current)setLoading(false)})
  return()=>{current=false}
 },[applied,revision])
 return <main className="workspace"><header className="workspace-header"><div><p className="eyebrow">Accountant review</p><h1>Daily reconciliation</h1><p>Recorded activity for one Korea business date, with current cross-journal checks.</p></div>{REPORT_PERMISSIONS.some(permission=>permissions.includes(permission))&&<a className="secondary-action" href="/reports">Detailed reports</a>}</header>
 <form className="panel action-row" onSubmit={event=>{event.preventDefault();setLoading(true);setApplied(day);setRevision(n=>n+1)}}><label className="field"><span>Korea business date</span><input required type="date" min="2000-01-01" max="2200-12-31" value={day} onChange={e=>setDay(e.target.value)}/></label><button className="primary-action" disabled={loading}>Review selected day</button></form>
 {loading?<LoadingState label="Reconciling recorded activity…"/>:error?<ErrorState message={error} onRetry={()=>{setLoading(true);setRevision(n=>n+1)}}/>:data&&<>
 <section className="panel form-stack"><h2>{data.status==='DISCREPANCIES'?'Recorded data needs reconciliation':data.status==='NO_POSTED_ACTIVITY'?'No posted activity for this date':'Automated journal checks are clear'}</h2>
 <p>Business date {data.business_date} · generated {formatBusinessTime(data.generated_at)}.</p>
 <p className={data.status==='DISCREPANCIES'?'error-message':'muted'} role={data.status==='DISCREPANCIES'?'alert':'status'}>{data.status==='DISCREPANCIES'?'Investigate the discrepancies below before treating the records as an approved close. No balance has been changed.':data.status==='NO_POSTED_ACTIVITY'?'A zero-activity report is not evidence that physical cash, opening balances or stock have been accepted.':'These checks cover the recorded journals. They do not certify physical cash, stock, complete source evidence or production readiness.'}</p>
 <a className="secondary-action" href={`/api/reconciliation/export?day=${encodeURIComponent(data.business_date)}`}>Export this reconciliation report</a>
 <p className="muted">Each refresh or export is a new, single-statement database snapshot. Preserve the generated timestamp with the file; later activity may change current checks or end-of-day totals for today.</p>
 </section>
 <section className="panel form-stack"><h2>Current cross-journal checks</h2><p>These checks cover all recorded history as it exists now, not a reconstruction of historical system health.</p>
 <div className="table-scroll" role="region" tabIndex={0} aria-label="Journal integrity checks"><table><thead><tr><th>Check</th><th>Records checked</th><th>Discrepancies</th></tr></thead><tbody>{data.checks.map(c=><tr key={c.code}><td>{c.label}</td><td>{c.checked_count}</td><td>{c.discrepancies===0?'0':<strong>{c.discrepancies} — review required</strong>}</td></tr>)}</tbody></table></div>
 <p className="muted">Unjournaled opening/demo balances are shown as discrepancies, never concealed or repaired by this report. Zero records checked is not operational acceptance.</p>
 </section>
 {SECTION_ORDER.map(section=><section key={section} className="panel form-stack"><h2>{section}</h2><div className="table-scroll" role="region" tabIndex={0} aria-label={`${section} reconciliation`}><table><thead><tr><th>Measure</th><th>Scope</th><th>Amount / count</th></tr></thead><tbody>{data.metrics.filter(m=>m.section===section).map(m=><tr key={m.key}><td>{m.label}</td><td>{SCOPE_LABELS[m.scope]}</td><td>{m.unit==='KRW'?<Money amount={m.value}/>:m.value}</td></tr>)}</tbody></table></div></section>)}
 <details className="panel"><summary>How to interpret this reconciliation</summary><p>Refunds use their posting date; cash handovers use their recorded date. A refund for an older purchase can therefore make today’s net sales negative.</p><p>Wallet opening and closing positions are reconstructed from journals. Positive prepaid balances and student debt are separate. They are not approved opening balances when the current wallet check has discrepancies.</p><p>Inventory values are the signed movement journal’s carrying values. A physical lot valuation can differ because of fractional unit-cost rounding; physical quantity checks remain separate. Returns written off are expenses, not stock restored.</p><p>Closing-date drawer totals can include movements from earlier days. Floats are not sales or wallet deposits. Unresolved requests are not proof of settlement: use the original operator and terminal to recover them before repeating a payment or handing cash back.</p><div className="action-row">{permissions.includes('wallet.read')&&<a className="secondary-action" href="/funding">Funding journal</a>}{permissions.includes('cash.history.all')&&<a className="secondary-action" href="/cash/history">Cash-close archive</a>}{permissions.includes('refunds.read')&&<a className="secondary-action" href="/refunds">Refunds and handovers</a>}</div></details>
 </>}
 </main>
}
