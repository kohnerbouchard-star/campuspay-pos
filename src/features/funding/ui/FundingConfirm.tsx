'use client'
import { useEffect,useRef } from 'react'
import { z } from 'zod'
import { CardReaderCapture } from '@/features/terminal/CardReaderCapture'
import { formatWon } from '@/lib/format/currency'
import { ConfirmFundingSchema,FUNDING_LABELS,type FundingIntent } from '../domain'
export function FundingConfirm({intent,busy,onScan,onConfirm,onRecover}:{intent:FundingIntent;busy:boolean;onScan(card:string):void;onConfirm(v:z.infer<typeof ConfirmFundingSchema>):void;onRecover():void}){
 const heading=useRef<HTMLHeadingElement>(null)
 useEffect(()=>{heading.current?.focus()},[intent.state])
 const scan=intent.requires_card&&intent.state==='PREPARED'
 return <section className="panel form-stack" aria-label="Funding verification">
 <h2 ref={heading} tabIndex={-1}>{FUNDING_LABELS[intent.action]}</h2>
 <p>Wallet change: <strong>{formatWon(intent.wallet_delta_won)}</strong> · drawer change: <strong>{formatWon(intent.cash_delta_won)}</strong></p>
 {intent.action==='CASH_DEPOSIT'&&<p>Cash received {formatWon(intent.cash_received_won)} · return change {formatWon(intent.change_won)}. Only the retained deposit is credited to the wallet and drawer.</p>}
 {intent.original_reference&&<p>Original receipt: {intent.original_reference}</p>}
 <p>{intent.source_reference} · {intent.notes}</p>
 {scan?<><CardReaderCapture active={!busy} onRead={onScan}/><p role="status">Reader ready. Scan the student card to verify the wallet.</p></>:<form className="form-stack" onSubmit={event=>{
  event.preventDefault();const form=event.currentTarget,data=new FormData(form),value=(name:string)=>String(data.get(name)??'')
  const input={requestKey:intent.request_key,verified:data.get('verified')==='yes',...(intent.requires_card?{studentPin:value('pin')}:{}),
   ...(intent.requires_approval?{approverCode:value('approver'),approverPin:value('approvalPin')}:{})}
  const v=ConfirmFundingSchema.safeParse(input);if(!v.success)return
  for(const name of ['pin','approvalPin']){const control=form.elements.namedItem(name);if(control instanceof HTMLInputElement)control.value=''}
  onConfirm(v.data)
 }}><fieldset disabled={busy} className="form-fields"><legend>Verify before recording</legend>
 {intent.requires_card&&<><div className="student-summary"><strong>{intent.student_name}</strong><p>{intent.student_code}{intent.year_group===null?'':` · Y${intent.year_group}`}</p><p>Current wallet {formatWon(intent.balance_won??0)} · projected {formatWon((intent.balance_won??0)+intent.wallet_delta_won)}</p></div>
 <label className="field"><span>Student PIN</span><input type="password" name="pin" required inputMode="numeric" autoComplete="off" pattern="[0-9]+" minLength={4} maxLength={12}/></label></>}
 {intent.requires_approval&&<><p>{intent.requires_card?'A different Super Admin':'A different accountant or Super Admin'} must inspect and approve this exact amount and reason.</p><label className="field"><span>Approver employee code</span><input name="approver" required minLength={2} maxLength={32} autoComplete="off"/></label><label className="field"><span>Approver PIN</span><input name="approvalPin" type="password" required inputMode="numeric" minLength={4} maxLength={16} pattern="[0-9]+" autoComplete="off"/></label></>}
 <label><input name="verified" type="checkbox" value="yes" required/> I verified the identity, amount and source; any cash movement and change have physically occurred as shown.</label>
 <p className="muted">This records the operation; it does not dispense cash. If rejected, return any unposted deposit. If the result is unknown, recover it before returning cash or repeating the operation.</p>
 <button className="primary-action">{busy?'Recording…':'Record verified operation'}</button>
 </fieldset></form>}
 <button className="secondary-action" disabled={busy} onClick={onRecover}>Cancel and verify no posting</button>
 </section>
}
