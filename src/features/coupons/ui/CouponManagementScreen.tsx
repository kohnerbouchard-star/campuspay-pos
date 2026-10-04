'use client'

import { useEffect, useState } from 'react'
import { fetchCoupons } from '@/features/coupons/client'
import type { CouponSummary } from '@/features/coupons/domain'
import { CouponForm } from '@/features/coupons/ui/CouponForm'
import { RecordRemovalProvider } from '@/features/removal/RecordRemoval'
import { CouponTable } from '@/features/coupons/ui/CouponTable'

export function CouponManagementScreen({userId,superAdmin=false,removalEnabled=false}:{userId:string;superAdmin?:boolean;removalEnabled?:boolean}) {
  const [coupons, setCoupons] = useState<CouponSummary[]>([])
  const [error, setError] = useState<string | null>(null)

  async function load() {
    try { setCoupons(await fetchCoupons()); setError(null) }
    catch (caught) { setError(caught instanceof Error ? caught.message : 'Coupons could not be loaded') }
  }

  useEffect(() => {
    let active = true
    void fetchCoupons().then(result => {
      if (active) { setCoupons(result); setError(null) }
    }).catch((caught: unknown) => {
      if (active) setError(caught instanceof Error ? caught.message : 'Coupons could not be loaded')
    })
    return () => { active = false }
  }, [])

  const content=<main className="workspace">
    <header className="workspace-header">
      <div><p className="eyebrow">Store promotions</p><h1>Coupons</h1></div>
      <span className="status-pill">Codes hidden after creation</span>
    </header>
    {error && <p className="error-message">{error}</p>}
    <div className="dashboard-grid">
      <CouponForm onSaved={() => void load()} />
      <section className="panel coupon-policy-panel">
        <div className="panel-heading"><div><p className="eyebrow">Checkout policy</p><h2>Redemption controls</h2></div></div>
        <p>One coupon can be used per sale. Its discount applies to the full sale before payment is divided between MICA Money and cash.</p>
        <p>Coupons with a per-student use limit require MICA Money. Cash-only purchases can use coupons without a per-student limit.</p>
        <p>Coupon terms cannot be edited after use. Deactivate the old coupon and issue a new code instead.</p>
      </section>
      <CouponTable coupons={coupons} onChanged={() => void load()} />
    </div>
  </main>
  return superAdmin?<RecordRemovalProvider userId={userId} enabled={removalEnabled} onChanged={load}>{content}</RecordRemovalProvider>:content
}
