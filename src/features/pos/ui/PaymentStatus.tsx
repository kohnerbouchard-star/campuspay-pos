'use client'
import { formatBusinessTime } from '@/lib/format/business-time'
import Link from 'next/link'
import type { PaymentPolicy } from '@/features/pos/domain'
export function PaymentStatus({ policy }: { policy: PaymentPolicy }) {
  return <section className={policy.cash_enabled ? 'event-status event-active' : 'event-status'} aria-label="Register payment status" role="status">
    <div><strong>{policy.cash_enabled ? 'EVENT MODE' : policy.event_status === 'EXPIRED' ? 'EVENT ENDED' : 'MICA Money'}</strong>
      <p>{policy.event_name && <b>{policy.event_name} · </b>}{policy.cash_enabled ? 'Cash + Split enabled' : 'MICA Money payments available'}</p>
      {policy.ends_at && <small>{policy.cash_enabled ? 'Until' : 'Ended'} {formatBusinessTime(policy.ends_at) + " KST"}</small>}
    </div>
    {policy.can_manage && <Link className="text-action" href="/settings/payments">Payment Settings</Link>}
  </section>
}
