import { useState } from 'react'
import { DENOMINATIONS, CashCountsSchema, denominationTotal } from '../domain'
import { formatWon } from '@/lib/format/currency'
export function CashCountForm({ closing, busy, onSubmit }: { closing: boolean; busy: boolean; onSubmit(counts: Record<string,number>, notes: string): void }) {
 const [counts,setCounts] = useState<Record<string,number>>(Object.fromEntries(DENOMINATIONS.map(n=>[String(n),0])))
 const [notes,setNotes] = useState(''),[verified,setVerified] = useState(false)
 const valid = CashCountsSchema.safeParse(counts).success && (!closing || notes.trim().length >= 10)
 return <form className="form-stack" onSubmit={e=>{e.preventDefault();if(verified && valid)onSubmit(counts,notes)}}><fieldset disabled={busy} className="form-fields"><legend>{closing ? 'Count and close this drawer' : 'Count the opening float'}</legend>
  <div className="summary-grid">{DENOMINATIONS.map(n=><label className="field" key={n}><span>{formatWon(n)} pieces</span><input type="number" inputMode="numeric" min={0} max={999999} step={1} required value={counts[n]} onChange={e=>setCounts({...counts,[n]:e.target.value===''?0:Number(e.target.value)})} /></label>)}</div>
  <p>Counted total: <strong>{formatWon(denominationTotal(counts))}</strong></p>
  {closing && <label className="field"><span>Close notes and any variance explanation</span><textarea required minLength={10} maxLength={500} value={notes} onChange={e=>setNotes(e.target.value)} /></label>}
  <label><input type="checkbox" required checked={verified} onChange={e=>setVerified(e.target.checked)} /> I physically counted this drawer and verified these quantities.</label>
  <p className="muted">Closing freezes this shift. New cash sales and cash payouts require an open shift when drawer controls are enabled. A non-zero variance needs an independent reviewer.</p>
  <button className="primary-action" disabled={!verified || !valid}>{busy?'Submitting…':closing?'Confirm drawer close':'Open cash shift'}</button>
 </fieldset></form>
}
