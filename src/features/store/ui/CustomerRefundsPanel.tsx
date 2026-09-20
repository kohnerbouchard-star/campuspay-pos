'use client'
import { useRef, useState } from 'react'
import { z } from 'zod'
import { apiFetch } from '@/lib/api/client'
import { formatWon } from '@/lib/format/currency'
import { CustomerRefundsSchema } from '@/features/refunds/partial-domain'
import styles from './store.module.css'
export function CustomerRefundsPanel({ orderId }: { orderId: string }) {
  const [data,setData] = useState<z.infer<typeof CustomerRefundsSchema> | null>(null)
  const [error,setError] = useState(''), [busy,setBusy] = useState(false), working = useRef(false)
  async function load(offset = 0) {
    if (working.current) return
    working.current = true; setBusy(true); setError('')
    try { const v = CustomerRefundsSchema.parse(await apiFetch<unknown>(`/api/store/orders/${orderId}/refunds?offset=${offset}`)); if (v.order_id !== orderId) throw new Error('Unexpected order'); setData(v) }
    catch { setError('Refund history could not be loaded. Reconnect or contact staff; a failed lookup does not mean no refund exists.') }
    finally { working.current = false; setBusy(false) }
  }
  return <section aria-label="Order refund history"><button className={styles.secondary} disabled={busy} onClick={() => void load()}>View or refresh refunds</button>
    {error && <p role="alert" className={styles.error}>{error}</p>}
    {data && <><p>Total refunded: {formatWon(data.refunded_won)} · {data.refund_count} receipts. Original purchase amounts above remain unchanged.</p>
      {data.refunds.map(r => <div key={r.refund_id}><p>{r.scope==='PARTIAL' ? 'Item refund' : 'Full refund'} · {formatWon(r.total_won)} · Wallet credited {formatWon(r.wallet_credit_won)}</p>
        {r.items.map((i,index) => <p key={index}>{i.quantity} × {i.product_name}: {formatWon(i.refund_won)}</p>)}</div>)}
      <p>Showing {data.refunds.length ? data.offset+1 : 0}–{data.offset+data.refunds.length} of {data.refund_count}.</p>
      <button className={styles.secondary} disabled={busy || data.offset===0} onClick={() => void load(Math.max(0,data.offset-50))}>Previous refund receipts</button>
      <button className={styles.secondary} disabled={busy || data.offset+50>=data.refund_count} onClick={() => void load(data.offset+50)}>Next refund receipts</button>
    </>}
  </section>
}
