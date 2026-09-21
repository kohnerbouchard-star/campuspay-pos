'use client'
import { useId,useState } from 'react'
import { ALLOWED_DENOMINATIONS_WON } from '@/features/wallets/domain'
import { DENOMINATIONS } from '@/features/cash/domain'
import { formatWon } from '@/lib/format/currency'
import { FUNDING_LABELS,PrepareFundingSchema,type FundingAction,type PrepareFunding } from '../domain'
export function FundingForm({finance,busy,onPrepare}:{finance:boolean;busy:boolean;onPrepare(v:PrepareFunding):void}){
 const id=useId(),[action,setAction]=useState<FundingAction>(finance?'CASH_DEPOSIT':'PAID_IN'),[units,setUnits]=useState<number[]>([]),[error,setError]=useState('')
 const wallet=['CASH_DEPOSIT','NONCASH_CREDIT','ADMIN_DEBIT'].includes(action),cash=['PAID_IN','PAID_OUT','CASH_DROP'].includes(action)
 return <form className="panel form-stack" onSubmit={event=>{
  event.preventDefault();const data=new FormData(event.currentTarget),get=(name:string)=>String(data.get(name)??'')
  const input={requestKey:crypto.randomUUID(),action,sourceReference:get('source'),notes:get('notes'),
   ...(wallet?{denominations:units}:{}),...(action==='CASH_DEPOSIT'?{cashReceivedWon:Number(get('received'))}:{}),
   ...(action==='REVERSE_FUNDING'?{originalReference:get('original')}:{}),...(cash?{counts:Object.fromEntries(DENOMINATIONS.map(d=>[String(d),Number(get(String(d))||0)]))}:{})}
  const v=PrepareFundingSchema.safeParse(input);if(!v.success){setError('Check the amount, cash received, source reference and a reason of at least 10 characters.');return}
  setError('');onPrepare(v.data)
 }}>
 <h2>Record funds or a cash movement</h2><p>Prepare the exact amount first. No money or stock changes until final confirmation.</p>
 {error&&<p role="alert" className="error-message">{error}</p>}
 <fieldset disabled={busy} className="form-fields"><legend>Choose the operation</legend>
 <label htmlFor={`${id}-kind`}>Operation</label><select id={`${id}-kind`} value={action} onChange={e=>{setAction(e.target.value as FundingAction);setUnits([])}}>
 {(Object.keys(FUNDING_LABELS) as FundingAction[]).filter(a=>finance||['PAID_IN','PAID_OUT','CASH_DROP'].includes(a)).map(a=><option key={a} value={a}>{FUNDING_LABELS[a]}</option>)}</select>
 {wallet&&<><div className="denominations">{ALLOWED_DENOMINATIONS_WON.map(d=><button type="button" key={d} disabled={units.length>=30} onClick={()=>setUnits(n=>[...n,d])}>+ {formatWon(d)}</button>)}</div><div className="selected-total"><span>Wallet amount</span><strong>{formatWon(units.reduce((a,b)=>a+b,0))}</strong><button type="button" disabled={!units.length} onClick={()=>setUnits(v=>v.slice(0,-1))}>Undo last amount</button></div></>}
 {action==='CASH_DEPOSIT'&&<label className="field"><span>Cash received before change (won)</span><input name="received" type="number" min={1} max={1000000000} step={1} required inputMode="numeric" /></label>}
 {action==='REVERSE_FUNDING'&&<><label className="field"><span>Original funding receipt</span><input name="original" required maxLength={80} placeholder="FND-…" /></label><p>Reverse the whole original deposit or correction once. A cash-deposit reversal records cash handed back and debits the original wallet; scan that student’s card. It is not a sale refund.</p></>}
 {cash&&<div className="form-stack">{DENOMINATIONS.map(d=><label className="field" key={d}><span>{formatWon(d)} pieces to {action==='PAID_IN'?'add':'remove'}</span><input name={String(d)} type="number" min={0} max={999999} step={1} defaultValue={0} inputMode="numeric" /></label>)}</div>}
 <label className="field"><span>Source / recipient / bank reference</span><input name="source" required minLength={3} maxLength={120} autoComplete="off" /></label>
 <label className="field"><span>Reason and supporting evidence</span><textarea name="notes" required minLength={10} maxLength={500} /></label>
 <p className="muted">Wallet amounts use the existing approved denominations. Cash movements require an open drawer on this terminal. Non-cash corrections and reversals require another Super Admin; manual cash movements require another accountant or Super Admin.</p>
 <button className="primary-action">Prepare operation</button>
 </fieldset></form>
}
