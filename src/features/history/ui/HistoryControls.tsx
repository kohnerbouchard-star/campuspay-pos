'use client'
import { useState } from 'react'
import { HistoryFiltersSchema,emptyHistoryFilters,type HistoryFilters } from '../domain'
export function HistoryControls({busy,onApply}:{busy:boolean;onApply(v:HistoryFilters):void}){
 const [from,setFrom]=useState(''),[to,setTo]=useState(''),[query,setQuery]=useState(''),[error,setError]=useState('')
 return <form className="form-stack" onSubmit={event=>{event.preventDefault();const v=HistoryFiltersSchema.safeParse({from:from||null,to:to||null,query,offset:0});if(!v.success){setError('Choose both dates within 366 days, or clear both for all history.');return}setError('');onApply(v.data)}}>
 <div className="action-row"><label className="field"><span>From (Korea)</span><input type="date" value={from} onChange={e=>setFrom(e.target.value)}/></label><label className="field"><span>To (Korea)</span><input type="date" value={to} onChange={e=>setTo(e.target.value)}/></label></div>
 <label className="field"><span>Find reference, reason, operator or notes</span><input type="search" maxLength={120} value={query} onChange={e=>setQuery(e.target.value)}/></label>
 <div className="action-row"><button className="secondary-action" disabled={busy}>Apply history filters</button><button type="button" className="secondary-action" disabled={busy} onClick={()=>{setFrom('');setTo('');setQuery('');setError('');onApply({...emptyHistoryFilters})}}>Show all history</button></div>
 {error&&<p role="alert" className="error-message">{error}</p>}
 </form>
}
export function HistoryPages({offset,total,length,busy,onPage}:{offset:number;total:number;length:number;busy:boolean;onPage(n:number):void}){
 return <nav className="action-row" aria-label="History pages"><button className="secondary-action" disabled={busy||offset===0} onClick={()=>onPage(Math.max(0,offset-50))}>Previous history page</button><span aria-live="polite">{length?offset+1:0}–{offset+length} of {total}</span><button className="secondary-action" disabled={busy||offset+50>=total} onClick={()=>onPage(offset+50)}>Next history page</button></nav>
}
