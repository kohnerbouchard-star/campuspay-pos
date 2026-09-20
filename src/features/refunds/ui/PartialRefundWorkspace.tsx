'use client'
import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import { apiFetch } from '@/lib/api/client'
import { formatWon } from '@/lib/format/currency'
import { RefundDecisionSchema, REFUND_MESSAGES, type RefundRecord, type RefundDecision } from '../domain'
import { PartialSnapshotSchema, type PartialSnapshot, type PostPartialRefundInput } from '../partial-domain'
import { clearRefundRecovery, readRefundRecovery, saveRefundRecovery } from '../storage'
import { PartialRefundEditor } from './PartialRefundEditor'
import { RefundReceipt } from './RefundReceipt'
export function PartialRefundWorkspace({ enabled, allowReturns, canPost, userId }: { enabled: boolean; allowReturns: boolean; canPost: boolean; userId: string }) {
  const [reference,setReference] = useState(''), [snapshot,setSnapshot] = useState<PartialSnapshot | null>(null)
  const [receipt,setReceipt] = useState<RefundRecord | null>(null), [pending,setPending] = useState<ReturnType<typeof readRefundRecovery>>(null)
  const [ready,setReady] = useState(false), [busy,setBusy] = useState(false), [error,setError] = useState(''), [message,setMessage] = useState('')
  const working = useRef(false)
  useEffect(() => {
    const timer = setTimeout(() => { try { setPending(readRefundRecovery(sessionStorage)); setReady(true) } catch { setError('Recovery storage is unreadable. Posting is blocked; resolve the saved request first.') } },0)
    return () => clearTimeout(timer)
  },[])
  async function load(ref: string, offset = 0) {
    const value = PartialSnapshotSchema.nullable().parse(await apiFetch<unknown>(`/api/refunds/items?reference=${encodeURIComponent(ref)}&offset=${offset}`))
    setSnapshot(value); if (!value) setMessage('No original sale was found.')
  }
  async function lookup(offset = 0, ref = reference.trim()) {
    if (working.current || pending) return
    working.current = true; setBusy(true); setError(''); setMessage(''); setReceipt(null)
    try { await load(ref,offset) }
    catch { setSnapshot(null); setError('The sale could not load. Verify the reference, connection and installed migrations.') }
    finally { working.current = false; setBusy(false) }
  }
  function accept(value: RefundDecision, saleId: string) {
    if (value.refund && value.refund.sale_id !== saleId) throw new Error('Unexpected refund identity')
    setMessage(REFUND_MESSAGES[value.outcome]); setReceipt(value.refund)
    if (value.outcome !== 'IDEMPOTENCY_CONFLICT') { clearRefundRecovery(sessionStorage); setPending(null) }
  }
  async function refreshConfirmed(saleId: string) {
    try { await load(saleId) } catch { setSnapshot(null); setError('The recorded refund result is confirmed. The directory refresh failed; reload before creating another refund.') }
  }
  async function submit(v: PostPartialRefundInput) {
    if (working.current || pending || !ready || !enabled || !canPost) return
    try { saveRefundRecovery(sessionStorage,v.saleId,v.idempotencyKey) }
    catch { setReady(false); setError('Safe recovery storage is unavailable. Nothing was submitted.'); return }
    working.current = true; setBusy(true); setPending({ saleId: v.saleId,idempotencyKey: v.idempotencyKey }); setError(''); setMessage('')
    let confirmed = false
    try { accept(RefundDecisionSchema.parse(await apiFetch<unknown>('/api/refunds/items',{ method:'POST',body:JSON.stringify(v) })),v.saleId); confirmed = true }
    catch { setError('Item refund result unknown. Recover the saved request before another refund or cash handover.') }
    finally { working.current = false; setBusy(false) }
    if (confirmed) await refreshConfirmed(v.saleId)
  }
  async function recover() {
    if (!pending || working.current || !canPost) return
    working.current = true; setBusy(true); setError(''); const saleId = pending.saleId; let confirmed = false
    try { accept(RefundDecisionSchema.parse(await apiFetch<unknown>('/api/refunds/recover',{ method:'POST',body:JSON.stringify(pending) })),saleId); confirmed = true }
    catch { setError('Recovery remains unconfirmed. Sign in as the original operator and reconnect; do not pay again.') }
    finally { working.current = false; setBusy(false) }
    if (confirmed) await refreshConfirmed(saleId)
  }
  const eligible = snapshot && snapshot.allocations.some(a => a.remaining_quantity > 0) && !snapshot.refunds.some(r => r.scope === 'FULL')
    && (snapshot.sale.channel === 'POS' || (allowReturns && snapshot.returns_enabled && ['OUT_FOR_DELIVERY','DELIVERED'].includes(snapshot.sale.order_status ?? '')))
  return <main className="workspace"><header className="workspace-header"><div><p className="eyebrow">Original-tender item corrections</p><h1>Item refunds and returns</h1><p>Repeated partial refunds with original-lot inspection. Each refund remains a separate immutable receipt.</p><Link href="/refunds">Full-sale refunds and net-day reports</Link></div></header>
    {!enabled && <p role="status">New item-level posting is disabled. Existing receipts and recovery remain available after the migration is installed.</p>}
    {!canPost && <p>Accountant read-only access. Only Super Admin can post or record a cash handover.</p>}
    {error && <p role="alert" className="error-message">{error}</p>}{message && <p role="status">{message}</p>}
    {pending && <section className="panel"><h2>Unresolved item refund</h2><p>Only opaque sale/request identifiers are stored. Recover before another refund.</p><button className="primary-action" disabled={busy || !canPost} onClick={() => void recover()}>Recover item refund result</button></section>}
    <section className="panel"><h2>Find original sale</h2><form className="toolbar" onSubmit={e => { e.preventDefault(); void lookup() }}><label className="field"><span>Receipt or order reference</span><input required maxLength={100} disabled={busy || Boolean(pending)} value={reference} onChange={e => setReference(e.target.value)} /></label><button className="secondary-action" disabled={busy || Boolean(pending)}>Load item refund history</button></form>
      {snapshot && <><h3>{snapshot.sale.receipt_number}</h3><p>{snapshot.sale.student_name ?? 'Cash customer'} · {snapshot.sale.student_code ?? 'No wallet'}{snapshot.sale.year_group ? ` · Y${snapshot.sale.year_group}` : ''}</p><p>Original paid: {formatWon(snapshot.sale.total_won)} · Total refunded: {formatWon(snapshot.refunded_won)} · {snapshot.refund_count} refund receipts</p><p>{snapshot.sale.order_status ?? 'POS sale'}</p></>}
    </section>
    {snapshot && enabled && snapshot.enabled && ready && !pending && !busy && eligible && <PartialRefundEditor key={`${snapshot.sale.sale_id}:${snapshot.refund_count}`} snapshot={snapshot} canPost={canPost} onSubmit={submit} />}
    {snapshot && !eligible && <p>No eligible remaining goods for this workflow. Pre-dispatch cancellation uses the full-sale workflow; completed quantities cannot be refunded twice.</p>}
    {receipt && !pending && <RefundReceipt key={receipt.refund_id} refund={receipt} userId={canPost ? userId : ''} onUpdate={setReceipt} />}
    {snapshot && <section className="panel"><h2>All refund receipts for this sale</h2><p>Showing {snapshot.refunds.length ? snapshot.offset+1 : 0}–{snapshot.offset+snapshot.refunds.length} of {snapshot.refund_count}. Select a receipt to review its own cash handover, not the latest receipt.</p>
      {snapshot.refunds.map(r => <p key={r.refund_id} style={{ overflowWrap:'anywhere' }}><button className="secondary-action" disabled={busy || Boolean(pending)} onClick={() => setReceipt(r)}>Open refund {r.refund_id}</button> {r.scope === 'PARTIAL' ? 'Item-level' : 'Full-sale'} · {formatWon(r.total_won)}</p>)}
      <button disabled={busy || Boolean(pending) || snapshot.offset===0} onClick={() => void lookup(Math.max(0,snapshot.offset-50),snapshot.sale.sale_id)}>Previous refunds</button>
      <button disabled={busy || Boolean(pending) || snapshot.offset+50>=snapshot.refund_count} onClick={() => void lookup(snapshot.offset+50,snapshot.sale.sale_id)}>Next refunds</button>
    </section>}
  </main>
}
