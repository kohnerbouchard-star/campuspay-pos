'use client'
import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import { apiFetch } from '@/lib/api/client'
import { formatWon } from '@/lib/format/currency'
import { PostReturnSchema, PostRefundSchema, RefundDecisionSchema, RefundSaleSchema, REFUND_MESSAGES, type PostRefundInput, type RefundDecision, type RefundRecord, type RefundSale } from '../domain'
import { clearRefundRecovery, readRefundRecovery, saveRefundRecovery } from '../storage'
import { RefundForm } from './RefundForm'
import { RefundReceipt } from './RefundReceipt'
import { RefundSummary } from './RefundSummary'
import { PartialRefundPreviewPanel } from './PartialRefundPreview'

export function RefundScreen({ enabled, canPost, canPayout, userId, allowReturns = false, previewEnabled = false, initialReference = '' }: { enabled: boolean; initialReference?: string; previewEnabled?: boolean; allowReturns?: boolean; canPost: boolean; canPayout:boolean; userId: string }) {
  const [reference, setReference] = useState(initialReference)
  const [sale, setSale] = useState<RefundSale | null>(null)
  const [refund, setRefund] = useState<RefundRecord | null>(null)
  const [pending, setPending] = useState<ReturnType<typeof readRefundRecovery>>(null)
  const [ready, setReady] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const inFlight = useRef(false)
  useEffect(() => {
    const timer = setTimeout(() => {
      try { setPending(readRefundRecovery(sessionStorage)); setReady(true) }
      catch { setError('Recovery storage is unavailable or malformed. Posting is blocked; resolve the saved request before proceeding.') }
    }, 0)
    return () => clearTimeout(timer)
  }, [])
  async function lookup() {
    if (inFlight.current || pending) return
    inFlight.current = true; setBusy(true); setError(null); setMessage(null); setSale(null); setRefund(null)
    try {
      const value = RefundSaleSchema.nullable().parse(await apiFetch<unknown>(`/api/refunds/sale?reference=${encodeURIComponent(reference.trim())}`))
      setSale(value); setRefund(value?.refund ?? null)
      if (!value) setMessage('No matching original sale was found.')
    } catch { setError('The original sale could not be loaded. Verify the reference and installed refund migration.') }
    finally { inFlight.current = false; setBusy(false) }
  }
  function accept(decision: RefundDecision, saleId: string) {
    if (decision.refund && decision.refund.sale_id !== saleId) throw new Error('Unexpected refund identity')
    setMessage(REFUND_MESSAGES[decision.outcome]); setRefund(decision.refund)
    if (decision.outcome !== 'IDEMPOTENCY_CONFLICT') { clearRefundRecovery(sessionStorage); setPending(null) }
  }
  async function post(draft: Omit<PostRefundInput, 'saleId' | 'idempotencyKey'> & { returnReason?: 'FAILED_DELIVERY' | 'CUSTOMER_RETURN' }) {
    if (inFlight.current || pending || !ready || !enabled || !canPost || !sale || refund) return
    if (draft.returnReason && !allowReturns) return
    const input = (draft.returnReason ? PostReturnSchema : PostRefundSchema).safeParse({ ...draft, saleId: sale.sale_id, idempotencyKey: crypto.randomUUID() })
    if (!input.success) { setError('Check the reason, notes, item dispositions and verification.'); return }
    try { saveRefundRecovery(sessionStorage, input.data.saleId, input.data.idempotencyKey) }
    catch { setError('Recovery storage could not be verified. Nothing was submitted.'); return }
    inFlight.current = true; setBusy(true); setError(null); setMessage(null)
    setPending({ saleId: input.data.saleId, idempotencyKey: input.data.idempotencyKey })
    try { accept(RefundDecisionSchema.parse(await apiFetch<unknown>(draft.returnReason ? '/api/refunds/return' : '/api/refunds', { method: 'POST', body: JSON.stringify(input.data) })), sale.sale_id) }
    catch { setError('Refund result unknown. Recover the result before starting another refund or paying cash.') }
    finally { inFlight.current = false; setBusy(false) }
  }
  async function recover() {
    if (inFlight.current || !pending || !canPost) return
    inFlight.current = true; setBusy(true); setError(null)
    try { accept(RefundDecisionSchema.parse(await apiFetch<unknown>('/api/refunds/recover', { method: 'POST', body: JSON.stringify(pending) })), pending.saleId) }
    catch { setError('Recovery is unconfirmed. Sign in as the original operator and reconnect; do not pay again.') }
    finally { inFlight.current = false; setBusy(false) }
  }
  return <main className="workspace"><header className="workspace-header"><div><p className="eyebrow">Append-only financial corrections</p><h1>Refunds</h1><p>Full-sale refunds, pre-dispatch cancellation, and verified post-dispatch returns. Original receipts are preserved.</p></div></header>
    <p><Link href={`/refunds/items?reference=${encodeURIComponent(reference.trim())}`}>Item refunds and returns — remaining quantities and all refund receipts</Link></p>
    {!enabled && <p role="status">New refunds are disabled for this installation. You can still look up existing records, recover an earlier request, or record an eligible outstanding cash handover.</p>}
    {!canPost && <p>Refund issue access is not assigned. Authorized refund records remain available.</p>}
    {error && <p role="alert" className="error-message">{error}</p>}{message && <p role="status">{message}</p>}
    {pending && <section className="panel"><h2>Unresolved refund request</h2><p>Only opaque sale and request IDs were saved. Recover before creating a new refund.</p>{canPost?<button className="primary-action" disabled={busy} onClick={() => void recover()}>Recover refund result</button>:<p>Use the original operator with assigned refund access to check this request.</p>}</section>}
    <section className="panel"><h2>Find original sale</h2><form className="toolbar" onSubmit={event => { event.preventDefault(); void lookup() }}><label className="field"><span>Receipt or online order number</span><input required maxLength={100} value={reference} onChange={event => setReference(event.target.value)} disabled={busy || Boolean(pending)} /></label><button className="secondary-action" disabled={busy || Boolean(pending)}>Find sale</button></form>
      {sale && <><h3>{sale.receipt_number}</h3><p>{sale.student_name ?? 'Cash customer'}{sale.year_group ? ` · Y${sale.year_group}` : ''} · {sale.student_code ?? 'No student wallet'} · {formatWon(sale.total_won)}</p>{sale.order_number && <p>{sale.order_number} · {sale.order_status}</p>}
        {!refund && !pending && ready && canPost && <RefundForm key={sale.sale_id} sale={sale} busy={busy||!enabled} allowReturns={allowReturns} onSubmit={post} />}</>}
    </section>
    {sale && !refund && !pending && previewEnabled && <PartialRefundPreviewPanel key={sale.sale_id} sale={sale} />}
    {refund && <RefundReceipt key={refund.refund_id} refund={refund} userId={canPayout ? userId : ''} onUpdate={setRefund} />}
    <RefundSummary />
  </main>
}
