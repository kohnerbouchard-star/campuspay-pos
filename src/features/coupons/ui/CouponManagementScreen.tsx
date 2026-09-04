'use client'

import { useEffect, useState } from 'react'
import { fetchCoupons } from '@/features/coupons/client'
import type { CouponSummary } from '@/features/coupons/domain'
import { CouponForm } from '@/features/coupons/ui/CouponForm'
import { CouponTable } from '@/features/coupons/ui/CouponTable'

export function CouponManagementScreen() {
  const [coupons, setCoupons] = useState<CouponSummary[]>([])
  const [error, setError] = useState<string | null>(null)

  async function load() {
    try {
      setCoupons(await fetchCoupons())
      setError(null)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Coupons could not be loaded')
    }
  }

  useEffect(() => { void load() }, [])

  return <main className="workspace">
    <header className="workspace-header">
      <div><p className="eyebrow">Promotion administration</p><h1>Coupon codes</h1></div>
      <span className="status-pill">Codes hidden after creation</span>
    </header>
    {error && <p className="error-message">{error}</p>}
    <div className="dashboard-grid">
      <CouponForm onSaved={() => void load()} />
      <section className="panel coupon-policy-panel">
        <div className="panel-heading"><div><p className="eyebrow">Checkout policy</p><h2>Redemption controls</h2></div></div>
        <p>Only one coupon may be attached to a sale. The server recalculates the discount from database prices and checks dates and global limits before card scan.</p>
        <p>After the student card is known, the final payment transaction locks the coupon and enforces the per-student limit before recording the redemption.</p>
        <p>Coupon terms cannot be edited after use. Deactivate the old coupon and issue a new code instead.</p>
      </section>
      <CouponTable coupons={coupons} onChanged={() => void load()} />
    </div>
  </main>
}
