'use client'
import { useState } from 'react'
import { formatWon } from '@/lib/format/currency'
import { FUNDING_LABELS,type FundingHistory,type FundingReceipt } from '../domain'
export function FundingReceiptView({receipt:r}:{receipt:FundingReceipt}){return <section className="panel form-stack" aria-label="Funding receipt"><h2>Recorded receipt {r.reference_number}</h2>
 <p>{FUNDING_LABELS[r.action]} · {r.created_at}</p>{r.student_code&&<p>{r.student_name} · {r.student_code}</p>}
 <p>Wallet change {formatWon(r.wallet_delta_won)} · cash change {formatWon(r.cash_delta_won)}</p>
 {r.balance_after_won!==null&&<p>Wallet: {formatWon(r.balance_before_won??0)} → <strong>{formatWon(r.balance_after_won)}</strong></p>}
 {r.action==='CASH_DEPOSIT'&&<p>Received {formatWon(r.cash_received_won)} · change returned {formatWon(r.change_won)}</p>}
 <p>Operator {r.actor_name}{r.approver_name?` · approved by ${r.approver_name}`:''}</p><p>Terminal {r.terminal_label??r.terminal_id}</p>
 <p>Source: {r.source_reference}</p><p>{r.notes}</p>{r.original_reference&&<p>Reversal of {r.original_reference}</p>}{r.reversed_by_reference&&<p>Reversed by {r.reversed_by_reference}</p>}</section>}
export function FundingJournal({data,offset,busy,onPage}:{data:FundingHistory;offset:number;busy:boolean;onPage(n:number):void}){
 const [selected,setSelected]=useState<FundingReceipt|null>(null)
 return <><section className="panel form-stack"><h2>Funding and cash journal</h2><p>{data.from} through {data.to}, Korea business dates. Totals include all {data.total} matching receipts, not only this page.</p>
 {!data.finance_access&&<p>Cashier view: cash-only movements on this terminal. Student wallet records are excluded.</p>}
 <p>{data.finance_access?`Net wallet change ${formatWon(data.wallet_net_won)} · `:''}cash in {formatWon(data.cash_in_won)} · cash out {formatWon(data.cash_out_won)}</p>
 <a className="secondary-action" href={`/api/funding/export?from=${encodeURIComponent(data.from)}&to=${encodeURIComponent(data.to)}`}>Export all receipts in this date range</a><p className="muted">Single-snapshot CSV; over 50,000 rows requires a narrower range and is never silently truncated.</p>
 <div className="table-scroll"><table><thead><tr><th>Receipt</th><th>Operation</th><th>Wallet</th><th>Cash</th><th>Operator</th><th>Details</th></tr></thead><tbody>{data.rows.map(r=><tr key={r.operation_id}><td>{r.reference_number}</td><td>{FUNDING_LABELS[r.action]}</td><td>{formatWon(r.wallet_delta_won)}</td><td>{formatWon(r.cash_delta_won)}</td><td>{r.actor_name}</td><td><button onClick={()=>setSelected(r)}>View receipt</button></td></tr>)}</tbody></table></div>
 {!data.rows.length&&<p>No matching funding receipts.</p>}<div className="action-row"><button disabled={busy||offset===0} onClick={()=>{setSelected(null);onPage(Math.max(0,offset-50))}}>Previous funding receipts</button><span>{data.rows.length?offset+1:0}–{offset+data.rows.length} of {data.total}</span><button disabled={busy||offset+50>=data.total} onClick={()=>{setSelected(null);onPage(offset+50)}}>Next funding receipts</button></div>
 </section>{selected&&<FundingReceiptView receipt={selected}/>}
 <section className="panel form-stack"><h2>Reconciliation checks</h2>
 {data.finance_access&&<p>Current wallet-to-ledger check (all time): {data.wallets_checked} wallets checked; <strong>{data.wallet_mismatches} mismatches</strong>.</p>}
 <p>Selected-date closed shifts: {data.closed_shifts_checked} checked; <strong>{data.closed_shift_mismatches} journal mismatches</strong>; {data.unreviewed_variances} unreviewed count variances.</p>
 <p>{data.unresolved_requests} unclosed prepared funding requests. These are not evidence of settled money; the original operator can recover or close them.</p>
 {(Number(data.wallet_mismatches)>0||data.closed_shift_mismatches>0||data.unreviewed_variances>0)&&<p className="error-message" role="alert">Reconciliation needs review. Do not invent an adjustment to hide a discrepancy.</p>}
 <p className="muted">These are funding, wallet-balance and cash-close checks—not certification of sales, inventory or the entire operating day. Zero transactions is not operating evidence.</p>
 </section></>
}
