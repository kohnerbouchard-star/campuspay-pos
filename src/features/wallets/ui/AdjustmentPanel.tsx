'use client'

import { useCallback, useMemo, useState } from 'react'
import { ALLOWED_DENOMINATIONS_WON, type AdjustmentIntent, type AdjustmentCardResult } from '@/features/wallets/domain'
import { openAdjustment, scanAdjustmentCard, confirmAdjustment } from '@/features/wallets/client'
import { CardReaderCapture } from '@/features/terminal/CardReaderCapture'
import { formatWon } from '@/lib/format/currency'

export function AdjustmentPanel(){const[direction,setDirection]=useState<'CREDIT'|'DEBIT'>('CREDIT');const[denominations,setDenominations]=useState<number[]>([]);const[notes,setNotes]=useState('Funds received by accounting office');const[intent,setIntent]=useState<AdjustmentIntent|null>(null);const[student,setStudent]=useState<AdjustmentCardResult|null>(null);const[pin,setPin]=useState('');const[message,setMessage]=useState<string|null>(null)
 const total=useMemo(()=>denominations.reduce((a,b)=>a+b,0),[denominations]);const reasonCode=direction==='CREDIT'?'FUNDS_RECEIVED':'OTHER_APPROVED_CORRECTION'
 async function begin(){try{setIntent(await openAdjustment({direction,denominations,reasonCode,notes}));setStudent(null);setMessage('Reader active. Scan the student card.')}catch(e){setMessage(e instanceof Error?e.message:'Could not start adjustment')}}
 const card=useCallback(async(value:string)=>{if(!intent||student)return;try{const result=await scanAdjustmentCard(intent.intent_id,value);setStudent(result);setMessage('Card recognized. Student must enter PIN.')}catch(e){setMessage(e instanceof Error?e.message:'Card not recognized')}},[intent,student])
 async function finish(e:React.FormEvent){e.preventDefault();if(!intent)return;try{const r=await confirmAdjustment(intent.intent_id,pin);setPin('');setIntent(null);setStudent(null);setDenominations([]);setMessage(`Posted ${formatWon(r.amount_won)}. New balance ${formatWon(r.balance_after_won)}.`)}catch(err){setPin('');setMessage(err instanceof Error?err.message:'Could not post adjustment')}}
 return <section className="panel"><CardReaderCapture active={Boolean(intent&&!student)} onRead={card}/><div className="panel-heading"><div><p className="eyebrow">No raw balance editing</p><h2>Controlled wallet transaction</h2></div><span className="status-pill">Card + PIN</span></div>
  <div className="segmented"><button className={direction==='CREDIT'?'active':''} onClick={()=>{setDirection('CREDIT');setDenominations([])}}>Add funds</button><button className={direction==='DEBIT'?'active':''} onClick={()=>{setDirection('DEBIT');setDenominations([])}}>Authorized deduction</button></div>
  <div className="denominations">{ALLOWED_DENOMINATIONS_WON.map(v=><button key={v} disabled={Boolean(intent)} onClick={()=>setDenominations(d=>[...d,v])}>+ {formatWon(v)}</button>)}</div>
  <div className="selected-total"><span>Transaction amount</span><strong>{formatWon(total)}</strong><button disabled={!denominations.length||Boolean(intent)} onClick={()=>setDenominations(d=>d.slice(0,-1))}>Undo last</button></div>
  <label className="field"><span>Reason / notes</span><input disabled={Boolean(intent)} value={notes} onChange={e=>setNotes(e.target.value)}/></label>
  {!intent&&<button className="primary-action" disabled={!denominations.length||notes.length<3} onClick={()=>void begin()}>Begin card verification</button>}
  {intent&&!student&&<div className="reader-state"><span className="reader-dot"/>Waiting for one card scan</div>}
  {student&&<form onSubmit={finish}><div className="student-summary"><strong>{student.student_display_name}</strong><div><span>Balance before</span><b>{formatWon(student.balance_before_won)}</b></div><div><span>Projected balance</span><b>{formatWon(student.projected_balance_won)}</b></div></div><label className="field"><span>Student PIN</span><input autoFocus type="password" inputMode="numeric" autoComplete="off" value={pin} onChange={e=>setPin(e.target.value.replace(/\D/g,'').slice(0,12))}/></label><button className="primary-action" disabled={pin.length<4}>Confirm transaction</button></form>}
  {message&&<p className="form-message">{message}</p>}
 </section>}
