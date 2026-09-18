import { useState } from 'react'
import type { CashShift } from '../domain'
import { formatWon } from '@/lib/format/currency'
import { businessDate } from '@/lib/format/business-time'
export function CashHistory({rows,userId,canReview,busy,onReview}:{rows:CashShift[];userId:string;canReview:boolean;busy:boolean;onReview(id:string,notes:string):void}) {
 const [selected,setSelected]=useState(''),[notes,setNotes]=useState('')
 function exportPage() {
  const fields=['shift_id','terminal_id','opened_at','closed_at','opening_float_won','cash_sales_won','cash_payouts_won','expected_won','counted_won','variance_won','review_required'] as const
  const quote=(v:unknown)=>`"${String(v??'').replaceAll('"','""')}"`
  const csv=[fields.join(','),...rows.map(r=>fields.map(k=>quote(r[k])).join(','))].join('\r\n')
  const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'})),a=document.createElement('a');a.href=url;a.download='campuspay-cash-closes-this-page.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)
 }
 return <section className="panel"><h2>Closed shifts</h2><button className="secondary-action" onClick={exportPage} disabled={!rows.length}>Export this page</button><div className="table-scroll"><table><thead><tr><th>Date (Korea)</th><th>Terminal</th><th>Expected</th><th>Counted</th><th>Over / short</th><th>Review</th></tr></thead><tbody>
 {rows.map(r=><tr key={r.shift_id}><td>{businessDate(new Date(r.closed_at!))}<small>{r.shift_id}</small></td><td>{r.terminal_label??r.terminal_id}</td><td>{formatWon(r.expected_won)}</td><td>{formatWon(r.counted_won??0)}</td><td>{formatWon(r.variance_won??0)}</td><td>{r.review_required?'Review required':'Reconciled / reviewed'}{r.review_required && canReview && r.closed_by!==userId && <button className="secondary-action" onClick={()=>{setSelected(r.shift_id);setNotes('')}}>Review variance</button>}</td></tr>)}
 </tbody></table></div>{!rows.length && <p>No closed shifts on this page.</p>}
 {selected && <form onSubmit={e=>{e.preventDefault();onReview(selected,notes)}}><p>Independent review for {selected}. This does not erase or alter the original variance.</p><label className="field"><span>Review evidence and approval notes</span><textarea required minLength={10} maxLength={500} value={notes} onChange={e=>setNotes(e.target.value)} /></label><button disabled={busy || notes.trim().length<10} className="primary-action">Approve documented variance</button><button type="button" className="secondary-action" onClick={()=>setSelected('')}>Cancel review</button></form>}
 </section>
}
