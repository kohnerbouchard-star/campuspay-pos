'use client'
import { useEffect, useState } from 'react'
import type { PaymentPolicy } from '@/features/pos/domain'
import { fetchPaymentPolicy } from '@/features/pos/client'
import { PaymentPolicyPanel } from '@/features/pos/ui/PaymentPolicyPanel'
import { ErrorState, LoadingState } from '@/components/ui/Feedback'
export function PaymentSettings() {
  const [policy, setPolicy] = useState<PaymentPolicy | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [revision, setRevision] = useState(0)
  useEffect(() => { let active = true; void fetchPaymentPolicy().then(value => { if (active) { setPolicy(value); setError(null) } }).catch((e: unknown) => { if (active) setError(e instanceof Error ? e.message : 'Settings could not be loaded.') }); return () => { active = false } }, [revision])
  return error ? <ErrorState message={error} onRetry={() => setRevision(value => value + 1)} /> : !policy ? <LoadingState /> : <section className="panel form-stack"><div className="panel-heading"><h2>{policy.terminal_label}</h2><span className="status-pill">This register only</span></div><dl className="definition-list"><div><dt>MICA Money</dt><dd>Always on</dd></div><div><dt>Cash payments</dt><dd>{policy.cash_enabled ? 'On' : 'Off'}</dd></div><div><dt>Split payments</dt><dd>{policy.cash_enabled ? 'On' : 'Off'}</dd></div>{policy.event_name && <div><dt>Event</dt><dd>{policy.event_name}</dd></div>}</dl><PaymentPolicyPanel policy={policy} onChange={setPolicy} /><p className="muted">Changes are recorded with your staff account. Disable cash when the event ends. Only cash applied to a sale contributes to cash reporting.</p></section>
}
